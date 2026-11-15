// Saklama işi sayaçları (jobs/retention.ts): tenant/global sayaç tipleri, sıfır değerleri, metrik `kind` etiketleri ve
// dry modda silme sayaçlarının `purgeCandidates` adları.
export interface TenantCounts {
  sessions: number;
  consents: number;
  files: number;
  requests: number;
  customers: number;
  bindings: number;
  /** P15 (AC-235): süresi 30 günden önce dolmuş talep engelleri (IP kişisel veri). */
  blocks: number;
  /** P16 (AC-240): kalıcı silinen (dry'da aday) satırlar. */
  purgedSessions: number;
  purgedConsents: number;
  purgedFiles: number;
  purgedRequests: number;
  purgedBindings: number;
  /** P18 H3 (ADR-0025 m.3): anonimleştirmeyle aynı TX'te silinen talep mesajları (dry modda da silinir — anonimleştirme adımı). */
  purgedMessages: number;
}
export interface GlobalCounts {
  audit: number;
  authSessions: number;
  resetTokens: number;
  /** P16 (S16-10): 730 g önce bitmiş/iptal edilmiş firma silme iş satırları (dry'da aday). */
  purgedJobs: number;
  /** P27a (AC-334): süresi dolmuş hatırlanan cihazlar (audit'lenmez; yalnız sayaç). */
  trustedDevices: number;
  /** P27 (mimari-p27 §3.6): kullanılmış/süresi dolmuş + 7 g kayıt kodları; 30 g önce iptal edilmiş, oturumsuz cihazlar. */
  unattendedRegistrations: number;
  unattendedDevices: number;
}
/** `rs_retention_rows_total{kind}` etiketleri (düşük kardinalite, sabit küme). */
export const KINDS: Record<keyof (TenantCounts & GlobalCounts), string> = {
  sessions: "sessions",
  consents: "consents",
  files: "files",
  requests: "requests",
  customers: "customers",
  bindings: "bindings",
  blocks: "request_blocks",
  purgedSessions: "purged_sessions",
  purgedConsents: "purged_consents",
  purgedFiles: "purged_files",
  purgedRequests: "purged_requests",
  purgedBindings: "purged_bindings",
  purgedMessages: "request_messages",
  audit: "audit",
  authSessions: "auth_sessions",
  resetTokens: "reset_tokens",
  purgedJobs: "purged_jobs",
  trustedDevices: "trusted_devices",
  unattendedRegistrations: "unattended_registrations",
  unattendedDevices: "unattended_devices",
};

const PURGE_KEYS = ["purgedSessions", "purgedConsents", "purgedFiles", "purgedRequests", "purgedBindings", "purgedJobs"] as const;
type PurgeKey = (typeof PURGE_KEYS)[number];
export const isPurgeKey = (k: string): k is PurgeKey => (PURGE_KEYS as readonly string[]).includes(k);
/** Dry modda sayaç anahtarı `purgeCandidates.<ad>` (`purgedSessions` → `sessions`). */
export const candidateName = (k: PurgeKey): string =>
  k.slice("purged".length, "purged".length + 1).toLowerCase() + k.slice("purged".length + 1);

export const zeroTenant = (): TenantCounts => ({
  sessions: 0,
  consents: 0,
  files: 0,
  requests: 0,
  customers: 0,
  bindings: 0,
  blocks: 0,
  purgedSessions: 0,
  purgedConsents: 0,
  purgedFiles: 0,
  purgedRequests: 0,
  purgedBindings: 0,
  purgedMessages: 0,
});
export const zeroGlobal = (): GlobalCounts => ({
  audit: 0,
  authSessions: 0,
  resetTokens: 0,
  purgedJobs: 0,
  trustedDevices: 0,
  unattendedRegistrations: 0,
  unattendedDevices: 0,
});
export const sum = (o: object): number => Object.values(o).reduce((a: number, b: unknown) => a + (typeof b === "number" ? b : 0), 0);
