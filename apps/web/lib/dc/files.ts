/*
 * Dosya transferi (AC-36, 53–55, 117, 119; mimari-protokol §4.1–4.2). İçerik yalnız `file` DataChannel'ından
 * geçer; sunucuya yalnız meta (`file.meta`; alıcı VE gönderen kendi raporunu gönderir — S-P5-3). Kurallar:
 * - Kabul gelmeden gönderen parça yollamaz; aynı anda yön başına tek aktif transfer, tek bekleyen teklif.
 * - Ad, gösterimden ÖNCE `sanitizeFileName` ile temizlenir; tehlikeli/çift uzantı ayrıca işaretlenir.
 * - Sınır ALINAN BAYT ile: `received > offer.size` veya `> maxBytes` → iptal + tampon atılır (beyana güvenilmez).
 * - `file.done` → SHA-256 doğrulama; uyuşmazlıkta tampon atılır, "Dosya bozuk" (AC-54).
 * - Ret sonrası 30 sn yeni teklif otomatik reddedilir (G-03). `file_transfer` yeteneği yoksa teklif otomatik ret (G-09).
 * - Güvenlik düzeltmesi (S-P5-1/2/4/5): gelen teklif 10 sn'de en çok 3 (aşan sessizce düşer, meta yok); karşı tarafın
 *   tetiklediği REJECTED/CANCELLED meta'ları (otomatik ret, onay beklerken iptal) tekilleştirilir ve dakikada en çok 5;
 *   kayıtlar en çok 100 (otomatik ret satırı listede en çok 20).
 * - TEST-P5-1: alıcı sınırı aşan teklifi sessizce düşürdüğü için gönderen (a) kendi teklif hızını aynı sınırın biraz
 *   üstünde bir pencereyle kendisi sınırlar ("rate" sonucu; teklif hiç çıkmaz) ve (b) yanıtsız kalan teklifi
 *   OFFER_TIMEOUT_MS sonra "Yanıt yok" ile kapatır (file.cancel + CANCELLED gönderen raporu) → gönderim kilidi açılır. Özet artımlı (ikinci tam kopya yok); büyük dosya
 *   destekleniyorsa (`showSaveFilePicker`) diske akar, değilse bellekte tek kopya; indirme Blob'u octet-stream.
 * Çerçeve: fidIndex(uint16, big-endian) | seq(uint32) | payload(≤ 16 KB). fidIndex = gönderenin teklif sırası
 * (0'dan; ctl sıralı olduğu için iki taraf aynı sayar).
 */
import {
  DEFAULT_MAX_FILE_MB,
  decodeFileChunk,
  encodeFileChunk,
  FILE_BUFFERED_LOW_THRESHOLD as BUFFER_LOW,
  FILE_BUFFERED_MAX as BUFFER_HIGH,
  FILE_CHUNK_MAX_PAYLOAD as CHUNK_BYTES,
  FILE_REJECT_COOLDOWN_MS as REJECT_COOLDOWN_MS,
  FileReceiveGuard,
  maxFileBytes,
} from "@remote/contracts/dc";
import { fileNameWarning, sanitizeFileName } from "@remote/contracts/files";
import { RateWindow } from "./rate";
import { Sha256 } from "./sha256";
import { newId, type CtlMessage, type FileDirection, type FileMetaMsg, type FileResult } from "./ctl";

export { sanitizeFileName, CHUNK_BYTES, REJECT_COOLDOWN_MS };
export const DEFAULT_MAX_FILE_BYTES = maxFileBytes(DEFAULT_MAX_FILE_MB);

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
export const KEEP = 100;
export const AUTO_KEEP = 20;
/** Bu boyuttan büyük gelen dosya, tarayıcı destekliyorsa doğrudan diske yazılır. */
export const DISK_MIN_BYTES = 256 * 1024 * 1024;
/** Disk akışı yokken bu boyutun üstünde kabul diyaloğunda bellek uyarısı. */
export const BIG_MEM_WARN_BYTES = 512 * 1024 * 1024;
const MEM_GROUP_BYTES = 8 * 1024 * 1024;
const TERMINAL = new Set<TransferStatus>(["ok", "corrupt", "rejected", "cancelled", "tooLarge", "busy", "timeout"]);

export interface WritableLike {
  write(d: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
type SavePicker = (o: { suggestedName?: string }) => Promise<{ createWritable(): Promise<WritableLike> }>;
const picker = (): SavePicker | undefined => (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
/** Tarayıcı dosyayı doğrudan diske yazabiliyor mu (File System Access). */
export const canStreamToDisk = () => typeof picker() === "function";

/**
 * AC-230: kabul diyaloğundaki "256 MB üzeri doğrudan diske yazılır; seçtiğiniz dosyanın üzerine yazılır" uyarısı
 * gösterilsin mi? Yalnız eşik (`DISK_MIN_BYTES`) AŞILINCA ve tarayıcı diske akış destekliyorsa (kayıt penceresi açılacaksa).
 */
export function shouldWarnLargeWrite(bytes: number, streamToDisk: boolean = canStreamToDisk()): boolean {
  return streamToDisk && bytes > DISK_MIN_BYTES;
}

/** Alınan içeriğin hedefi: bellek (tek kopya, 8 MB'lık Blob grupları) ya da disk (doğrulanmadan kaydedilmez). */
interface Sink {
  write(u: Uint8Array): void;
  /** ok=false → içerik atılır. Dönüş: başarılı mı + (bellekte) indirme adresi. */
  finish(ok: boolean): Promise<{ ok: boolean; url?: string }>;
  discard(): void;
}
function memorySink(): Sink {
  let parts: Blob[] = [];
  let pend: Uint8Array[] = [];
  let pendBytes = 0;
  const flush = () => {
    if (pend.length) parts.push(new Blob(pend as BlobPart[]));
    pend = [];
    pendBytes = 0;
  };
  return {
    write(u) {
      pend.push(u.slice());
      pendBytes += u.byteLength;
      if (pendBytes >= MEM_GROUP_BYTES) flush();
    },
    async finish(ok) {
      flush();
      // S-P5-5: tür açıkça octet-stream — blob: adresi yeni sekmede açılırsa HTML/SVG olarak çizilmez
      const url = ok ? URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" })) : undefined;
      parts = [];
      return { ok, url };
    },
    discard() {
      pend = [];
      parts = [];
    },
  };
}
/** Chromium: yazılanlar `close()`'a kadar geçici dosyada; bozuksa `abort()` ile hiç kaydedilmez. Dışa açık: birim testi (S-P5-T2-1). */
export function diskSink(w: WritableLike): Sink {
  let q: Promise<void> = Promise.resolve();
  let failed = false;
  let closed = false;
  return {
    write(u) {
      const c = u.slice();
      q = q.then(() => w.write(c)).catch(() => void (failed = true));
    },
    async finish(ok) {
      await q;
      closed = true;
      try {
        if (ok && !failed) {
          await w.close();
          return { ok: true };
        }
        await w.abort();
      } catch {
        /* yazılamadı → bozuk say */
      }
      return { ok: false };
    },
    discard() {
      if (closed) return;
      closed = true;
      void q.then(() => w.abort()).catch(() => undefined);
    },
  };
}

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

interface OutState {
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
interface InState {
  t: Transfer;
  idx: number;
  sha: string;
  sink: Sink;
  hash: Sha256;
  guard: FileReceiveGuard;
  /** file.done ctl'den geldi ama son parçalar file kanalında henüz yolda (iki DC arasında sıra garantisi yok). */
  doneTimer?: ReturnType<typeof setTimeout>;
}
/** file.done sonrası eksik parçalar için bekleme; dolunca eksikse bozuk sayılır. */
const DONE_WAIT_MS = 10_000;

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
}

export class FileTransfers {
  private out = new Map<string, OutState>();
  private inc = new Map<string, InState>();
  private list: Transfer[] = [];
  private outCount = 0;
  /** Gelen teklif sayısı (tanı amaçlı). */
  inCount = 0;
  /** Hız sınırıyla düşürülen gelen teklif sayısı (tanı/test). */
  dropped = 0;
  private lastReject = -Infinity;
  /** Gönderilen tekliflerin zamanları (SELF_OFFER_LIMIT). */
  private sentOffers: number[] = [];
  private readonly max: number;
  private readonly now: () => number;
  private readonly offers: RateWindow;
  private readonly peerMeta: RateWindow;
  /** Karşı tarafın tetiklediği meta tekilleştirme: anahtar → son gönderim. */
  private peerMetaSeen = new Map<string, number>();

  constructor(private d: TransferDeps) {
    this.max = d.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.now = d.now ?? Date.now;
    this.offers = new RateWindow(OFFER_LIMIT.max, OFFER_LIMIT.windowMs, this.now);
    this.peerMeta = new RateWindow(PEER_META_LIMIT.max, PEER_META_LIMIT.windowMs, this.now);
    d.file.bufferedAmountLowThreshold = BUFFER_LOW;
  }

  get transfers(): Transfer[] {
    return this.list;
  }

  private put(t: Transfer) {
    const i = this.list.findIndex((x) => x.fid === t.fid && x.dir === t.dir);
    this.list = i < 0 ? [...this.list, t] : this.list.map((x, j) => (j === i ? t : x));
    if (i < 0) this.prune();
    this.d.onChange(this.list);
  }
  /** S-P5-2: Map'ler ve liste sınırlı; önce en eski bitmiş kayıtlar düşer (aktif/bekleyen korunur). */
  private prune() {
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
    for (const k of drop) {
      const [dir, fid] = [k.slice(0, k.indexOf(".")), k.slice(k.indexOf(".") + 1)];
      const s = dir === "in" ? this.inc.get(fid) : this.out.get(fid);
      if (dir === "in" && s?.t.url) URL.revokeObjectURL(s.t.url);
      if (dir === "in") this.inc.delete(fid);
      else this.out.delete(fid);
    }
    this.list = this.list.filter((x) => !drop.has(`${x.dir}.${x.fid}`));
  }
  private set(st: { t: Transfer }, patch: Partial<Transfer>) {
    st.t = { ...st.t, ...patch };
    this.put(st.t);
  }
  private meta(st: InState, result: FileResult) {
    this.d.sendMeta({
      t: "file.meta",
      fid: st.t.fid,
      direction: this.d.inbound,
      fileName: st.t.name,
      sizeBytes: Math.min(st.t.size, 2 ** 31),
      sha256: st.sha,
      result,
    });
  }
  /**
   * Karşı tarafın tetiklediği (kullanıcı kararı olmadan) REJECTED/CANCELLED raporu: aynı ad/boyut/özet dakikada bir,
   * toplam dakikada en çok PEER_META_LIMIT.max. Aşan rapor gönderilmez (S-P5-1: OK/CORRUPT kotası korunur).
   */
  private peerDrivenMeta(st: InState, result: FileResult) {
    const t = this.now();
    for (const [k, at] of this.peerMetaSeen) if (t - at >= PEER_META_LIMIT.windowMs) this.peerMetaSeen.delete(k);
    const key = `${result}|${st.t.name}|${st.t.size}|${st.sha}`;
    if (this.peerMetaSeen.has(key) || !this.peerMeta.take()) return;
    this.peerMetaSeen.set(key, t);
    this.meta(st, result);
  }
  /** Gönderen raporu (mimari-protokol §3 file.meta): transfer başına bir kez, yön = giden. */
  private senderMeta(st: OutState, result: FileResult) {
    if (st.reported || !st.sha) return;
    st.reported = true;
    const direction: FileDirection = this.d.inbound === "TO_CUSTOMER" ? "TO_TECH" : "TO_CUSTOMER";
    const fileName = sanitizeFileName(st.t.name.slice(0, 255)) || "dosya";
    this.d.sendMeta({
      t: "file.meta",
      fid: st.t.fid,
      direction,
      fileName,
      sizeBytes: Math.min(st.t.size, 2 ** 31),
      sha256: st.sha,
      result,
    });
  }
  private activeOut = () => [...this.out.values()].some((o) => ["offered", "hashing", "sending"].includes(o.t.status));
  private activeIn = () => [...this.inc.values()].some((o) => ["pending", "receiving", "verifying"].includes(o.t.status));

  /** Gönderim başlatır; sonuç: başladı / sınır aşımı / zaten aktif transfer / yetki yok. */
  async send(file: File): Promise<"ok" | "tooLarge" | "busy" | "denied" | "rate"> {
    if (!this.d.allowed()) return "denied";
    if (file.size > this.max) return "tooLarge";
    if (this.activeOut()) return "busy";
    const t0 = this.now();
    this.sentOffers = this.sentOffers.filter((x) => t0 - x < SELF_OFFER_LIMIT.windowMs);
    if (this.sentOffers.length >= SELF_OFFER_LIMIT.max && this.d.selfThrottle?.() !== false) return "rate";
    const fid = newId();
    const st: OutState = {
      t: { fid, dir: "out", name: file.name, size: file.size, done: 0, status: "hashing", ...fileRisk(file.name) },
      idx: this.outCount++ & 0xffff,
      file,
      sha: "",
      abort: false,
    };
    this.out.set(fid, st);
    this.put(st.t);
    st.sha = this.d.corruptSha?.() ? "0".repeat(64) : await sha256Hex(file);
    if (st.abort) return "ok";
    this.set(st, { status: "offered" });
    this.sentOffers.push(this.now());
    st.offerTimer = setTimeout(() => this.offerTimedOut(st), this.d.offerTimeoutMs?.() || OFFER_TIMEOUT_MS);
    this.d.sendCtl({ t: "file.offer", fid, idx: st.idx, name: file.name.slice(0, 255) || "dosya", size: file.size, sha256: st.sha });
    return "ok";
  }

  /** Yanıtsız teklif: alıcıya iptal (ulaştıysa diyaloğu kapanır), gönderen raporu, kilit açılır. */
  private offerTimedOut(st: OutState) {
    st.offerTimer = undefined;
    if (st.t.status !== "offered") return;
    st.abort = true;
    this.set(st, { status: "timeout" });
    this.d.sendCtl({ t: "file.cancel", fid: st.t.fid });
    this.senderMeta(st, "CANCELLED");
  }
  private clearOffer(st: OutState) {
    clearTimeout(st.offerTimer);
    st.offerTimer = undefined;
  }

  /**
   * Kabul. DISK_MIN_BYTES üstünde ve tarayıcı destekliyorsa önce kayıt yeri sorulur (kullanıcı hareketi içinde);
   * kayıt penceresi kapatılırsa teklif beklemede kalır. Destek yoksa / hata olursa bellek yolu.
   */
  async accept(fid: string): Promise<void> {
    const st = this.inc.get(fid);
    if (!st || st.t.status !== "pending") return;
    const pick = st.t.size > DISK_MIN_BYTES ? picker() : undefined;
    if (pick) {
      try {
        const h = await pick({ suggestedName: st.t.name });
        const w = await h.createWritable();
        if (st.t.status !== "pending") return void w.abort().catch(() => undefined);
        st.sink = diskSink(w);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return; // kullanıcı vazgeçti → karar bekleniyor
      }
      if (st.t.status !== "pending") return;
    }
    this.set(st, { status: "receiving" });
    this.d.sendCtl({ t: "file.accept", fid });
  }

  reject(fid: string) {
    const st = this.inc.get(fid);
    if (!st || st.t.status !== "pending") return;
    this.lastReject = this.now();
    this.set(st, { status: "rejected" });
    this.d.sendCtl({ t: "file.reject", fid });
    this.meta(st, "REJECTED");
  }

  cancel(fid: string, dir: "in" | "out") {
    if (dir === "out") {
      const st = this.out.get(fid);
      if (!st || !["hashing", "offered", "sending"].includes(st.t.status)) return;
      st.abort = true;
      this.clearOffer(st);
      this.set(st, { status: "cancelled" });
      if (st.sha) {
        this.d.sendCtl({ t: "file.cancel", fid });
        this.senderMeta(st, "CANCELLED");
      }
      return;
    }
    const st = this.inc.get(fid);
    if (!st || !["receiving", "verifying"].includes(st.t.status)) return;
    st.sink.discard();
    this.set(st, { status: "cancelled" });
    this.d.sendCtl({ t: "file.cancel", fid });
    this.meta(st, "CANCELLED");
  }

  /** ctl'den gelen file.* mesajı. */
  async onCtl(m: CtlMessage): Promise<void> {
    if (m.t === "file.offer") return this.onOffer(m);
    if (m.t === "file.accept") {
      const st = this.out.get(m.fid);
      if (st?.t.status === "offered") {
        this.clearOffer(st);
        await this.pump(st);
      }
    } else if (m.t === "file.reject") {
      const st = this.out.get(m.fid);
      if (st?.t.status === "offered") {
        this.clearOffer(st);
        this.set(st, { status: "rejected" });
        this.senderMeta(st, "REJECTED");
      }
    } else if (m.t === "file.cancel") {
      const o = this.out.get(m.fid);
      if (o && ["offered", "sending"].includes(o.t.status)) {
        o.abort = true;
        this.clearOffer(o);
        this.set(o, { status: "cancelled" });
        this.senderMeta(o, "CANCELLED");
      }
      const i = this.inc.get(m.fid);
      if (i && ["pending", "receiving", "verifying"].includes(i.t.status)) {
        const wasPending = i.t.status === "pending";
        i.sink.discard();
        this.set(i, { status: "cancelled" });
        // Onay beklerken gelen iptal karşı tarafın elinde (teklif+iptal seli) → sınırlı rapor
        if (wasPending) this.peerDrivenMeta(i, "CANCELLED");
        else this.meta(i, "CANCELLED");
      }
    } else if (m.t === "file.done") {
      const st = this.inc.get(m.fid);
      if (!st || st.t.status !== "receiving" || st.doneTimer !== undefined) return;
      // ctl ve file ayrı kanallar: done, son parçalardan önce gelebilir → tamamlanınca (veya süre dolunca) doğrula
      if (st.guard.bytes >= st.t.size) await this.verify(m.fid);
      else st.doneTimer = setTimeout(() => void this.verify(m.fid), DONE_WAIT_MS);
    } else if (m.t === "file.result") {
      const st = this.out.get(m.fid);
      if (st?.t.status === "sending") {
        this.set(st, { status: m.ok ? "ok" : "corrupt", done: st.t.size });
        this.senderMeta(st, m.ok ? "OK" : "CORRUPT");
      }
    }
  }

  private onOffer(m: Extract<CtlMessage, { t: "file.offer" }>) {
    // S-P5-1/2: teklif seli — aşan teklif hiç işlenmez (ret yok, liste yok, sunucuya meta yok)
    if (!this.offers.take()) {
      this.dropped++;
      return;
    }
    // Aynı fid ile ikinci teklif: reddedilir, mevcut transfer ve sayaç değişmez
    if (this.inc.has(m.fid)) return this.d.sendCtl({ t: "file.reject", fid: m.fid });
    const idx = m.idx; // çerçeve eşlemesi teklifin idx alanıyla (alıcı sayacı değil)
    this.inCount++;
    const name = sanitizeFileName(m.name);
    const st: InState = {
      t: { fid: m.fid, dir: "in", name, size: m.size, done: 0, status: "pending", ...fileRisk(name) },
      idx,
      sha: m.sha256,
      sink: memorySink(),
      hash: new Sha256(),
      guard: new FileReceiveGuard(m.size, this.max),
    };
    const auto: Transfer["auto"] = !this.d.allowed()
      ? "caps"
      : m.size > this.max
        ? "tooLarge"
        : this.now() - this.lastReject < REJECT_COOLDOWN_MS
          ? "cooldown"
          : this.activeIn()
            ? "busy"
            : undefined;
    this.inc.set(m.fid, st);
    this.prune();
    if (auto) {
      st.t = { ...st.t, status: auto === "tooLarge" ? "tooLarge" : "rejected", auto };
      // Yetkisiz teklif listede gösterilmez (G-09: UI pasif); diğerleri bilgi olarak görünür
      if (auto !== "caps") this.put(st.t);
      this.d.sendCtl({ t: "file.reject", fid: m.fid });
      this.peerDrivenMeta(st, "REJECTED");
      return;
    }
    this.put(st.t);
  }

  /** `file` kanalından gelen ikili çerçeve. */
  onFrame(buf: ArrayBuffer) {
    const f = decodeFileChunk(buf);
    if (!f) return;
    const st = [...this.inc.values()].find((x) => x.idx === f.fidIndex && x.t.status === "receiving");
    if (!st) return;
    // Sınır ALINAN BAYT ile (beyan edilen size'a güvenilmez); sıra dışı parça da iptal
    const r = st.guard.add(f);
    if (r !== "ok") {
      st.sink.discard();
      this.set(st, { status: r === "exceeded" ? "tooLarge" : "corrupt", done: 0 });
      this.d.sendCtl({ t: "file.cancel", fid: st.t.fid });
      this.meta(st, "CANCELLED");
      return;
    }
    st.hash.update(f.payload);
    st.sink.write(f.payload);
    this.set(st, { done: st.guard.bytes });
    if (st.doneTimer !== undefined && st.guard.bytes >= st.t.size) void this.verify(st.t.fid);
  }

  private async verify(fid: string) {
    const st = this.inc.get(fid);
    if (!st || st.t.status !== "receiving") return;
    clearTimeout(st.doneTimer);
    this.set(st, { status: "verifying" });
    // Özet parçalar gelirken artımlı hesaplandı: içerik ikinci kez okunmaz/kopyalanmaz (S-P5-4)
    const res = await st.sink.finish(st.guard.complete() && st.hash.hex() === st.sha);
    if ((st.t.status as TransferStatus) !== "verifying") {
      if (res.url) URL.revokeObjectURL(res.url);
      return; // bu arada iptal edildi
    }
    const ok = res.ok;
    if (ok) this.set(st, { status: "ok", url: res.url });
    else this.set(st, { status: "corrupt", done: 0 }); // tampon atıldı: dosya hiç kaydedilmez/sunulmaz
    this.d.sendCtl({ t: "file.result", fid, ok });
    this.meta(st, ok ? "OK" : "CORRUPT");
  }

  private waitLow(): Promise<void> {
    const ch = this.d.file;
    return new Promise((res) => {
      const fn = () => {
        ch.removeEventListener("bufferedamountlow", fn);
        res();
      };
      ch.addEventListener("bufferedamountlow", fn);
    });
  }

  private async pump(st: OutState) {
    this.set(st, { status: "sending" });
    const ch = this.d.file;
    let seq = 0;
    for (let off = 0; off < st.file.size; off += CHUNK_BYTES) {
      if (st.abort || ch.readyState !== "open") return;
      if (ch.bufferedAmount > BUFFER_HIGH) await this.waitLow();
      const delay = this.d.chunkDelayMs?.() ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (st.abort || ch.readyState !== "open") return;
      const part = new Uint8Array(await st.file.slice(off, off + CHUNK_BYTES).arrayBuffer());
      ch.send(encodeFileChunk(st.idx, seq++, part) as Uint8Array<ArrayBuffer>);
      this.set(st, { done: Math.min(off + part.byteLength, st.t.size) });
    }
    if (!st.abort) this.d.sendCtl({ t: "file.done", fid: st.t.fid });
  }

  /** Bağlantı koptu/oturum bitti: aktifler iptal, object URL'ler serbest. */
  dispose() {
    for (const o of this.out.values()) {
      o.abort = true;
      this.clearOffer(o);
    }
    for (const i of this.inc.values()) {
      clearTimeout(i.doneTimer);
      i.sink.discard();
      if (i.t.url) URL.revokeObjectURL(i.t.url);
    }
  }
}
