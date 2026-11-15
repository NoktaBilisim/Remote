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
import { FILE_BUFFERED_LOW_THRESHOLD as BUFFER_LOW } from "@remote/contracts/dc";
import type { CtlMessage } from "./ctl";
import { FileReceiver } from "./file-receive";
import { FileSender } from "./file-send";
import { TransferStore, type Transfer, type TransferDeps } from "./file-model";

// Parçalar: ortak model/depo `file-model.ts`, gönderen `file-send.ts`, alan `file-receive.ts`, bellek/disk hedefi
// `file-disk.ts`. Dışa açık adlar bu yoldan verilmeye devam eder (çağıranların importu değişmez).
export {
  AUTO_KEEP,
  fileRisk,
  OFFER_LIMIT,
  OFFER_TIMEOUT_MS,
  PEER_META_LIMIT,
  SELF_OFFER_LIMIT,
  sha256Hex,
  type FileChannelLike,
  type Transfer,
  type TransferStatus,
} from "./file-model";
export { BIG_MEM_WARN_BYTES, canStreamToDisk, DISK_MIN_BYTES, diskSink, shouldWarnLargeWrite, type WritableLike } from "./file-disk";

export class FileTransfers {
  private readonly store: TransferStore;
  private readonly tx: FileSender;
  private readonly rx: FileReceiver;

  constructor(d: TransferDeps) {
    this.store = new TransferStore(d);
    this.tx = new FileSender(this.store);
    this.rx = new FileReceiver(this.store);
    d.file.bufferedAmountLowThreshold = BUFFER_LOW;
  }

  get transfers(): Transfer[] {
    return this.store.list;
  }
  /** Gelen teklif sayısı (tanı amaçlı). */
  get inCount(): number {
    return this.rx.inCount;
  }
  /** Hız sınırıyla düşürülen gelen teklif sayısı (tanı/test). */
  get dropped(): number {
    return this.rx.dropped;
  }

  /** Gönderim başlatır; sonuç: başladı / sınır aşımı / zaten aktif transfer / yetki yok. */
  send(file: File): Promise<"ok" | "tooLarge" | "busy" | "denied" | "rate"> {
    return this.tx.send(file);
  }

  /**
   * Kabul. DISK_MIN_BYTES üstünde ve tarayıcı destekliyorsa önce kayıt yeri sorulur (kullanıcı hareketi içinde);
   * kayıt penceresi kapatılırsa teklif beklemede kalır. Destek yoksa / hata olursa bellek yolu.
   */
  accept(fid: string): Promise<void> {
    return this.rx.accept(fid);
  }

  reject(fid: string) {
    this.rx.reject(fid);
  }

  cancel(fid: string, dir: "in" | "out") {
    if (dir === "out") this.tx.cancel(fid);
    else this.rx.cancel(fid);
  }

  /** ctl'den gelen file.* mesajı. */
  async onCtl(m: CtlMessage): Promise<void> {
    if (m.t === "file.offer") return this.rx.onOffer(m);
    if (m.t === "file.accept") await this.tx.onAccept(m);
    else if (m.t === "file.reject") this.tx.onReject(m);
    else if (m.t === "file.cancel") {
      this.tx.onCancel(m);
      this.rx.onCancel(m);
    } else if (m.t === "file.done") await this.rx.onDone(m);
    else if (m.t === "file.result") this.tx.onResult(m);
  }

  /** `file` kanalından gelen ikili çerçeve. */
  onFrame(buf: ArrayBuffer) {
    this.rx.onFrame(buf);
  }

  /** Bağlantı koptu/oturum bitti: aktifler iptal, object URL'ler serbest. */
  dispose() {
    this.tx.dispose();
    this.rx.dispose();
  }
}
