/*
 * P21 K-P21-2: P19 web talep formunun veri kaynağı adaptörü. Form, bekleme odası, WS ve iptal AYNI bileşenlerdir; yalnız
 * "form bilgisini al", "gövdeyi kur" ve "talebi gönder" adımları kaynağa göre değişir.
 *   - `publicRequestSource(ref)`: `/r/<ref>` — bugünkü herkese açık uçlar (form token'ı, 2 sn bekleme, gizli alan). Davranış aynen.
 *   - `portalRequestSource(...)` (lib/portal/request-source.ts): portal oturumu + CSRF; ref/token/gizli alan YOK.
 */
import type { CreateRequestResponse, WebFormInfo } from "@remote/contracts/api/requests";
import { api } from "@/lib/api";
import { buildWebRequest, storeKeyOf, type FormDraft } from "./flow";

/** Gönderilecek gövde: en az `customerName` (bekleme odasında gösterilir). */
export type RequestBody = { customerName: string };

export interface WebRequestSource {
  /** sessionStorage anahtarı (talep sırrı yalnız sekme kapsamında; F5'te bekleme odasına dönüş). */
  storeKey: string;
  /** Form bilgisi. Portal kaynağında token/bekleme yok → `formToken: ""`, `minDelayMs: 0`. Hata `ApiError`/`NetworkError`. */
  loadInfo: () => Promise<WebFormInfo>;
  build: (d: FormDraft, clientInstanceId: string, info: WebFormInfo) => { body?: RequestBody; errors: Record<string, string> };
  create: (body: RequestBody) => Promise<CreateRequestResponse>;
  /** Kabul kartındaki "Uygulamayı indir" bağlantısı (firma dosyası). */
  downloadHref: string;
  /** Formun ilk taslağı (portal: ad/e-posta `PortalMe`'den, düzenlenebilir). */
  initialDraft?: Partial<FormDraft>;
  /** `true` → herkese açık müşteri çerçevesi (`GuestShell`); portal kendi kabuğunu kullanır. */
  framed: boolean;
  /** Oturum kapısı hatası (portal 401 / şifre değişimi) → yönlendirildiyse true; form başka bir şey göstermez. */
  onGateError?: (e: unknown) => boolean;
}

/** `/r/<ref>` — P19 herkese açık uçlar (değişmedi). */
export function publicRequestSource(ref: string): WebRequestSource {
  return {
    storeKey: storeKeyOf(ref),
    loadInfo: () => api<WebFormInfo>("GET", `/public/web-requests/form?ref=${encodeURIComponent(ref)}`),
    build: (d, clientInstanceId, info) => buildWebRequest(d, { ref, formToken: info.formToken, clientInstanceId, info }),
    create: (body) => api<CreateRequestResponse>("POST", "/public/web-requests", body),
    downloadHref: `/api/v1/public/agent/request-download?ref=${encodeURIComponent(ref)}`,
    framed: true,
  };
}
