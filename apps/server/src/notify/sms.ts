// Firma SMS istemcisi (P19 J3, mimari-e11 §8c.3–8c.4; ortak standart §2.3 — smsportal, arkada NetGSM).
//  - Etkin hedef: tenant `sms_url` ?? env `SMSPORTAL_URL`. Tenant adresi her gönderimde netguard'dan geçer ve IP'ye
//    sabitlenir (S-P19-5); env varsayılanı devops'un güvenilen adresidir (guard'sız; WA sistem adresi kalıbı).
//  - Production: tenant adresi yalnız https + 443 (S-P19-T7, K-P19-10; aksi `host_not_allowed`); http + genel host + anahtar
//    → güvensiz, kanal kapalı.
//  - Anahtar AES-256-GCM, AAD etkin kökene bağlı. Çözülemezse (köken/`SMSPORTAL_URL` değişti, sürüm emekli) `unconfigured`
//    (kalıcı), `keyUnreadable`, `rs_sms_key_unreadable_total`, tenant başına saatte 1 warn (anahtar/adres loga yazılmaz; S-P19-T6).
//  - `POST {url}/api/external/send-sms` + `x-api-key`, gövde `{phone:"5xxxxxxxxx", message, header?}`; 8 sn; TEK deneme.
import { toSmsPhone } from "@remote/contracts/api/notify";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import type { NetGuard } from "../lib/netguard.ts";
import { postJson, type OutboundOutcome } from "../lib/outbound.ts";
import type { Metrics } from "../ops/metrics.ts";
import { isInsecureServiceTarget, isParsableServiceUrl } from "./service-url.ts";

const SMS_TIMEOUT_MS = 8_000;
const HOUR_MS = 3_600_000;

type SmsOutcome = OutboundOutcome | "unconfigured" | "invalid_phone";

interface Log {
  warn(obj: object, msg: string): void;
}

interface SmsDeps {
  db: Pick<Db, "tenantSettings">;
  secrets: SecretBox;
  guard: NetGuard;
  /** env `SMSPORTAL_URL` (kanonik) ya da `""`. */
  envUrl: string;
  production: boolean;
  log: Log;
  metrics: Metrics;
  now?: () => number;
}

interface SmsState {
  url: string | null;
  /** Etkin adres tenant kaydı mı (netguard + 443 kuralı yalnız onda). */
  tenantUrl: boolean;
  header: string | null;
  apiKey: string | null;
  apiKeySet: boolean;
  keyUnreadable: boolean;
  insecure: boolean;
  updatedAt: Date | null;
}

export const originOf = (url: string): string => new URL(url).origin;

/** Production'da tenant adresi yalnız https ve varsayılan port (443). */
export const tenantUrlPortOk = (url: string, production: boolean): boolean => {
  if (!production) return true;
  const u = new URL(url);
  return u.protocol === "https:" && u.port === "";
};

export class SmsClient {
  private readonly d: SmsDeps;
  private readonly warned = new Map<string, number>();

  constructor(d: SmsDeps) {
    this.d = d;
  }

  get defaultUrlSet(): boolean {
    return this.d.envUrl !== "";
  }

  /** Tenant'ın etkin SMS durumu (anahtar çözülür; değeri asla dışarı/loga gitmez). */
  async state(tenantId: string): Promise<SmsState> {
    const r = await this.d.db.tenantSettings.findUnique({
      where: { tenantId },
      select: { smsUrl: true, smsApiKeyEnc: true, smsHeader: true, updatedAt: true },
    });
    const url = r?.smsUrl ?? (this.d.envUrl !== "" ? this.d.envUrl : null);
    const enc = r?.smsApiKeyEnc ?? null;
    let apiKey: string | null = null;
    let keyUnreadable = false;
    if (url && enc) {
      try {
        apiKey = isParsableServiceUrl(url) ? this.d.secrets.decrypt(enc, aadFor.smsApiKey(tenantId, originOf(url))) : null;
        keyUnreadable = apiKey === null;
      } catch {
        keyUnreadable = true;
      }
    }
    const insecure = url !== null && isInsecureServiceTarget(url, enc !== null, this.d.production);
    return {
      url,
      tenantUrl: r?.smsUrl != null,
      header: r?.smsHeader ?? null,
      apiKey,
      apiKeySet: enc !== null,
      keyUnreadable,
      insecure,
      updatedAt: r?.updatedAt ?? null,
    };
  }

  /** Kanal kullanılabilir mi (adres + çözülebilir anahtar + güvenli). Form/ayar/send-link kapısı. */
  static usable(s: SmsState): boolean {
    return s.url !== null && s.apiKey !== null && !s.insecure;
  }

  async usableFor(tenantId: string): Promise<boolean> {
    return SmsClient.usable(await this.state(tenantId));
  }

  /** Tek deneme. Yeniden deneme çağıranda (outbox). Sonuç sınıflandırılmış; numara/anahtar/adres loga yazılmaz. */
  async send(tenantId: string, phoneE164: string, message: string, pre?: SmsState): Promise<SmsOutcome> {
    const phone = toSmsPhone(phoneE164);
    if (!phone) return this.count("invalid_phone");
    const s = pre ?? (await this.state(tenantId));
    if (s.keyUnreadable) this.keyUnreadable(tenantId);
    if (!s.url || !s.apiKey || s.insecure) return this.count("unconfigured");
    if (s.tenantUrl && !tenantUrlPortOk(s.url, this.d.production)) return this.count("host_not_allowed");
    const out = await postJson(
      `${s.url.replace(/\/+$/, "")}/api/external/send-sms`,
      { phone, message, ...(s.header ? { header: s.header } : {}) },
      { headers: { "x-api-key": s.apiKey }, timeoutMs: SMS_TIMEOUT_MS, guard: s.tenantUrl ? this.d.guard : null },
    );
    return this.count(out);
  }

  private count<T extends SmsOutcome>(r: T): T {
    this.d.metrics.inc("rs_sms_send_total", { result: r });
    return r;
  }

  private keyUnreadable(tenantId: string): void {
    this.d.metrics.inc("rs_sms_key_unreadable_total");
    const now = (this.d.now ?? Date.now)();
    if ((this.warned.get(tenantId) ?? 0) > now - HOUR_MS) return;
    this.warned.set(tenantId, now);
    this.d.log.warn({ alarm: "sms_key_unreadable", tenantId }, "kayıtlı SMS API anahtarı etkin adresle çözülemiyor; kanal kapalı");
  }
}
