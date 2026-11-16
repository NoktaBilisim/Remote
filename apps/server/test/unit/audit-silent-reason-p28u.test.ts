// D-P28u-K1-1: audit okuma görünümünde izinsiz bağlantı gerekçesi maskesi (saf karar + değer görünümü).
import { describe, expect, it } from "vitest";
import { auditValueView, carriesSilentReason, silentReasonVisible } from "../../src/audit/view.ts";

const row = { entity: "support_sessions", entityId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", tenantId: "01ARZ3NDEKTSV4RRFFQ69G5FAT" };
const key = `${row.tenantId}:${row.entityId}`;

describe("D-P28u-K1-1 gerekçe görünürlüğü", () => {
  it("D-P28u-K1-1: yalnız yetki ∧ oturum var ∧ anonim değil → açık; aksi (yetkisiz, satır yok/anonim, başka tenant, başka entity) maskeli", () => {
    expect(silentReasonVisible(row, true, new Set([key]))).toBe(true);
    expect(silentReasonVisible(row, false, new Set([key]))).toBe(false);
    expect(silentReasonVisible(row, true, new Set())).toBe(false);
    expect(silentReasonVisible({ ...row, tenantId: "01ARZ3NDEKTSV4RRFFQ69G5FAX" }, true, new Set([key]))).toBe(false);
    expect(silentReasonVisible({ ...row, entity: "users" }, true, new Set([key]))).toBe(false);
    expect(silentReasonVisible({ ...row, entityId: null }, true, new Set([key]))).toBe(false);
  });

  it("D-P28u-K1-1: auditValueView varsayılanı maskeli (fail-closed); açıkken değer döner; diğer alanlar etkilenmez", () => {
    const v = { deviceId: "d", consentMode: "silent", silentReason: "Ali'nin bilgisayarı" };
    expect(auditValueView("unattended.connect", v)).toEqual({ ...v, silentReason: "***" });
    expect(auditValueView("unattended.connect", v, false, false)).toEqual(v);
    expect(auditValueView("unattended.connect", { silentReason: null })).toEqual({ silentReason: null });
    expect(carriesSilentReason(v)).toBe(true);
    expect(carriesSilentReason({ consentRequested: "ask" })).toBe(false);
    expect(carriesSilentReason(null)).toBe(false);
  });
});
