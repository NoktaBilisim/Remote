/*
 * Dosya alan taraf ("al" parçası, lib/dc/files.ts): teklif seli sınırı, otomatik ret (yetki/boyut/bekleme/meşgul),
 * kabul (büyük dosyada diske), ALINAN BAYT ile sınır, artımlı SHA-256 doğrulama; karşı tarafın tetiklediği
 * REJECTED/CANCELLED raporları tekilleştirilir ve sınırlanır (S-P5-1).
 */
import { decodeFileChunk, FILE_REJECT_COOLDOWN_MS as REJECT_COOLDOWN_MS, FileReceiveGuard } from "@remote/contracts/dc";
import { sanitizeFileName } from "@remote/contracts/files";
import type { CtlMessage, FileResult } from "./ctl";
import { DISK_MIN_BYTES, diskSink, memorySink, picker } from "./file-disk";
import {
  DONE_WAIT_MS,
  fileRisk,
  OFFER_LIMIT,
  PEER_META_LIMIT,
  type InState,
  type Transfer,
  type TransferStatus,
  type TransferStore,
} from "./file-model";
import { RateWindow } from "./rate";
import { Sha256 } from "./sha256";

type FidMsg<T extends CtlMessage["t"]> = Extract<CtlMessage, { t: T }>;

export class FileReceiver {
  /** Gelen teklif sayısı (tanı amaçlı). */
  inCount = 0;
  /** Hız sınırıyla düşürülen gelen teklif sayısı (tanı/test). */
  dropped = 0;
  private lastReject = -Infinity;
  private readonly offers: RateWindow;
  private readonly peerMeta: RateWindow;
  /** Karşı tarafın tetiklediği meta tekilleştirme: anahtar → son gönderim. */
  private peerMetaSeen = new Map<string, number>();

  constructor(private s: TransferStore) {
    this.offers = new RateWindow(OFFER_LIMIT.max, OFFER_LIMIT.windowMs, s.now);
    this.peerMeta = new RateWindow(PEER_META_LIMIT.max, PEER_META_LIMIT.windowMs, s.now);
  }

  private get d() {
    return this.s.d;
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
    const t = this.s.now();
    for (const [k, at] of this.peerMetaSeen) if (t - at >= PEER_META_LIMIT.windowMs) this.peerMetaSeen.delete(k);
    const key = `${result}|${st.t.name}|${st.t.size}|${st.sha}`;
    if (this.peerMetaSeen.has(key) || !this.peerMeta.take()) return;
    this.peerMetaSeen.set(key, t);
    this.meta(st, result);
  }
  private activeIn = () => [...this.s.inc.values()].some((o) => ["pending", "receiving", "verifying"].includes(o.t.status));

  /**
   * Kabul. DISK_MIN_BYTES üstünde ve tarayıcı destekliyorsa önce kayıt yeri sorulur (kullanıcı hareketi içinde);
   * kayıt penceresi kapatılırsa teklif beklemede kalır. Destek yoksa / hata olursa bellek yolu.
   */
  async accept(fid: string): Promise<void> {
    const st = this.s.inc.get(fid);
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
    this.s.set(st, { status: "receiving" });
    this.d.sendCtl({ t: "file.accept", fid });
  }

  reject(fid: string) {
    const st = this.s.inc.get(fid);
    if (!st || st.t.status !== "pending") return;
    this.lastReject = this.s.now();
    this.s.set(st, { status: "rejected" });
    this.d.sendCtl({ t: "file.reject", fid });
    this.meta(st, "REJECTED");
  }

  /** Kullanıcı alımı iptal etti. */
  cancel(fid: string) {
    const st = this.s.inc.get(fid);
    if (!st || !["receiving", "verifying"].includes(st.t.status)) return;
    st.sink.discard();
    this.s.set(st, { status: "cancelled" });
    this.d.sendCtl({ t: "file.cancel", fid });
    this.meta(st, "CANCELLED");
  }

  /** Karşı taraf iptal etti (gelen yön). */
  onCancel(m: FidMsg<"file.cancel">) {
    const i = this.s.inc.get(m.fid);
    if (i && ["pending", "receiving", "verifying"].includes(i.t.status)) {
      const wasPending = i.t.status === "pending";
      i.sink.discard();
      this.s.set(i, { status: "cancelled" });
      // Onay beklerken gelen iptal karşı tarafın elinde (teklif+iptal seli) → sınırlı rapor
      if (wasPending) this.peerDrivenMeta(i, "CANCELLED");
      else this.meta(i, "CANCELLED");
    }
  }

  async onDone(m: FidMsg<"file.done">) {
    const st = this.s.inc.get(m.fid);
    if (!st || st.t.status !== "receiving" || st.doneTimer !== undefined) return;
    // ctl ve file ayrı kanallar: done, son parçalardan önce gelebilir → tamamlanınca (veya süre dolunca) doğrula
    if (st.guard.bytes >= st.t.size) await this.verify(m.fid);
    else st.doneTimer = setTimeout(() => void this.verify(m.fid), DONE_WAIT_MS);
  }

  onOffer(m: FidMsg<"file.offer">) {
    // S-P5-1/2: teklif seli — aşan teklif hiç işlenmez (ret yok, liste yok, sunucuya meta yok)
    if (!this.offers.take()) {
      this.dropped++;
      return;
    }
    // Aynı fid ile ikinci teklif: reddedilir, mevcut transfer ve sayaç değişmez
    if (this.s.inc.has(m.fid)) return this.d.sendCtl({ t: "file.reject", fid: m.fid });
    const idx = m.idx; // çerçeve eşlemesi teklifin idx alanıyla (alıcı sayacı değil)
    this.inCount++;
    const name = sanitizeFileName(m.name);
    const st: InState = {
      t: { fid: m.fid, dir: "in", name, size: m.size, done: 0, status: "pending", ...fileRisk(name) },
      idx,
      sha: m.sha256,
      sink: memorySink(),
      hash: new Sha256(),
      guard: new FileReceiveGuard(m.size, this.s.max),
    };
    const auto = this.autoReject(m.size);
    this.s.inc.set(m.fid, st);
    this.s.prune();
    if (auto) {
      st.t = { ...st.t, status: auto === "tooLarge" ? "tooLarge" : "rejected", auto };
      // Yetkisiz teklif listede gösterilmez (G-09: UI pasif); diğerleri bilgi olarak görünür
      if (auto !== "caps") this.s.put(st.t);
      this.d.sendCtl({ t: "file.reject", fid: m.fid });
      this.peerDrivenMeta(st, "REJECTED");
      return;
    }
    this.s.put(st.t);
  }

  /** Otomatik ret nedeni (yoksa undefined): yetki, boyut, ret sonrası bekleme, aktif alım. */
  private autoReject(size: number): Transfer["auto"] {
    if (!this.d.allowed()) return "caps";
    if (size > this.s.max) return "tooLarge";
    if (this.s.now() - this.lastReject < REJECT_COOLDOWN_MS) return "cooldown";
    return this.activeIn() ? "busy" : undefined;
  }

  /** `file` kanalından gelen ikili çerçeve. */
  onFrame(buf: ArrayBuffer) {
    const f = decodeFileChunk(buf);
    if (!f) return;
    const st = [...this.s.inc.values()].find((x) => x.idx === f.fidIndex && x.t.status === "receiving");
    if (!st) return;
    // Sınır ALINAN BAYT ile (beyan edilen size'a güvenilmez); sıra dışı parça da iptal
    const r = st.guard.add(f);
    if (r !== "ok") {
      st.sink.discard();
      this.s.set(st, { status: r === "exceeded" ? "tooLarge" : "corrupt", done: 0 });
      this.d.sendCtl({ t: "file.cancel", fid: st.t.fid });
      this.meta(st, "CANCELLED");
      return;
    }
    st.hash.update(f.payload);
    st.sink.write(f.payload);
    this.s.set(st, { done: st.guard.bytes });
    if (st.doneTimer !== undefined && st.guard.bytes >= st.t.size) void this.verify(st.t.fid);
  }

  private async verify(fid: string) {
    const st = this.s.inc.get(fid);
    if (!st || st.t.status !== "receiving") return;
    clearTimeout(st.doneTimer);
    this.s.set(st, { status: "verifying" });
    // Özet parçalar gelirken artımlı hesaplandı: içerik ikinci kez okunmaz/kopyalanmaz (S-P5-4)
    const res = await st.sink.finish(st.guard.complete() && st.hash.hex() === st.sha);
    if ((st.t.status as TransferStatus) !== "verifying") {
      if (res.url) URL.revokeObjectURL(res.url);
      return; // bu arada iptal edildi
    }
    const ok = res.ok;
    if (ok) this.s.set(st, { status: "ok", url: res.url });
    else this.s.set(st, { status: "corrupt", done: 0 }); // tampon atıldı: dosya hiç kaydedilmez/sunulmaz
    this.d.sendCtl({ t: "file.result", fid, ok });
    this.meta(st, ok ? "OK" : "CORRUPT");
  }

  /** Bağlantı koptu/oturum bitti: alımlar atılır, object URL'ler serbest. */
  dispose() {
    for (const i of this.s.inc.values()) {
      clearTimeout(i.doneTimer);
      i.sink.discard();
      if (i.t.url) URL.revokeObjectURL(i.t.url);
    }
  }
}
