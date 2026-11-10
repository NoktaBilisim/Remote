// Audit değer maskesi (mimari §3.3, G-15, AC-75). Tek dosya, iki liste:
// 1) izinli liste önce uygulanır (anahtar adı tam eşleşme → ilkel değer açık kalır; değer nesne/dizi ise
//    içi yine özyinelemeli taranır — S1-7),
// 2) kara liste anahtar adına regex ile uygulanır → "***". Değer tarafında tarama yok.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "perm_key",
  "permKey",
  "action",
  "entity",
  "level",
  "decision",
  "source",
  "direction",
  "result",
  "reason",
]);

const MASKED_KEY =
  /pass|secret|token|key|nonce|totp|code|ticket|credential|recovery|cookie|authorization|sdp|candidate|admit/i;

export const MASK = "***";

export function maskValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value === null || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const [key, inner] of Object.entries(value)) {
    if (ALLOWED_KEYS.has(key)) out[key] = maskValue(inner);
    else if (MASKED_KEY.test(key)) out[key] = MASK;
    else out[key] = maskValue(inner);
  }
  return out;
}
