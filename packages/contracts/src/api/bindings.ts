// Bilgisayar kaydı (P8c) public sözleşmesi — mimari-api "Public (P8c)", mimari-e10 §3.3–3.4, §5, §15; ADR-0017.
// `bindingKey` yalnız gövdede taşınır (URL'de asla); resolve/join/ticket/reconnect/TURN uçlarının şemalarına uymaz (AC-184).
// Go eşi `internal/api/bindings.go`; ortak örnekler `fixtures/bindings.json`.
import { z } from "zod";
import { bindingKeySchema, clientVersionSchema, type TenantRequestInfo } from "./requests.ts";

export { bindingKeySchema } from "./requests.ts";

/** `rsb_` + base64url(32 bayt) = 47 karakter (256 bit). Sunucu yalnız SHA-256 özetini saklar. */
export const BINDING_KEY_PREFIX = "rsb_";

/** `binding.offer` yalnız bu sürüm ve üstündeki AGENT ticket'ına gönderilir (mimari-e10 §1, protokol §6). */
export const BINDING_MIN_CLIENT_VERSION = "0.10.0";

/** `device_bindings.revoke_reason` (ikili CHECK; r2 §15.2). */
export const BINDING_REVOKE_REASONS = [
  "FORGOTTEN",
  "REPLACED",
  "CUSTOMER_ROTATED",
  "CUSTOMER_PASSIVE",
  "GENERAL_ROTATED",
  "TENANT_PASSIVE",
  "EXPIRED",
  "ADMIN_REVOKED",
] as const;
export type BindingRevokeReason = (typeof BINDING_REVOKE_REASONS)[number];

/** Oturum başına en çok `binding.request` (mimari-e10 §5.3; aşımda `error{RATE_LIMITED}`). */
export const BINDING_ISSUE_PER_SESSION = 3;

/** İstemci metinleri (AC-185, AC-186, AC-190; Go istemciyle ortak — fixture). */
export const BINDING_INVALID_MESSAGE =
  "Bu bilgisayarın destek kaydı artık geçerli değil. Firmanızdan yeni dosya isteyin ya da teknisyeninizin verdiği kodla bağlanın.";
export const BINDING_FORGOTTEN_MESSAGE = "Bu bilgisayar unutuldu";
export const BINDING_NO_SOURCE_MESSAGE =
  "Destek istemek için firmanızın gönderdiği dosyayı kullanın veya teknisyeninizin verdiği kodu girin";
/** `binding.request` reddi (`error{CONFLICT}`): oturum/tenant/müşteri uygun değil ya da bayat kaynak (§15.1). */
export const BINDING_DENIED_MESSAGE = "Kayıt verilemedi";

/** POST /public/bindings/status (AC-182, 185). `last_used_at`'i değiştirmez (K21). */
export const bindingStatusInputSchema = z.strictObject({ bindingKey: bindingKeySchema, clientVersion: clientVersionSchema });
export type BindingStatusInput = z.infer<typeof bindingStatusInputSchema>;

/** POST /public/bindings/revoke (AC-186): her durumda 204 (oracle yok). */
export const bindingRevokeInputSchema = z.strictObject({ bindingKey: bindingKeySchema });
export type BindingRevokeInput = z.infer<typeof bindingRevokeInputSchema>;

/** POST /public/bindings/status yanıtı: `TenantRequestInfo` + müşteri firma adı (Genel kayıtta null). */
export interface BindingInfo extends TenantRequestInfo {
  customer: { name: string } | null;
}
