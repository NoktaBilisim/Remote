// P16 (AC-237, AC-241, AC-242) sözleşme testleri: kullanıcı silme girdisi, firma silme şemaları, audit maskesi yardımcıları.
import { describe, expect, it } from "vitest";
import { purgeJobsQuerySchema, TENANT_PURGE_STEPS, tenantPurgeInputSchema } from "../src/api/tenants.ts";
import { AUDIT_ACTION_GROUPS } from "../src/api/audit.ts";
import { confirmNameMatches, deleteUserInputSchema, userOptionsQuerySchema } from "../src/api/users.ts";
import {
  AUDIT_ENTITY,
  AUDIT_IDENTITY_KEYS,
  deletedTenantLabel,
  deletedUserLabel,
  maskIdentity,
  MIGRATION_AUDIT,
  P16_AUDIT_LABELS,
  TENANT_PURGE_AUDIT,
  UPLOADS_AUDIT,
  USER_AUDIT,
} from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { PERMISSION_DESCRIPTIONS } from "../src/permissions.ts";

describe("P16 contracts", () => {
  it("AC-241 confirmName: trim + NFC, harf duyarlı; boş ve 100+ reddedilir", () => {
    const nfd = "Şule Öz".normalize("NFD");
    const r = deleteUserInputSchema.parse({ confirmName: `  ${nfd} ` });
    expect(r.confirmName).toBe("Şule Öz".normalize("NFC"));
    expect(confirmNameMatches(nfd, "Şule Öz")).toBe(true);
    expect(confirmNameMatches("şule öz", "Şule Öz")).toBe(false);
    expect(deleteUserInputSchema.safeParse({ confirmName: "   " }).success).toBe(false);
    expect(deleteUserInputSchema.safeParse({ confirmName: "a".repeat(101) }).success).toBe(false);
    expect(deleteUserInputSchema.safeParse({ confirmName: "Ali", extra: 1 }).success).toBe(false);
  });

  it("AC-241 maskIdentity ve etiketler", () => {
    expect(maskIdentity("ayse@example.com")).toBe("a***@***");
    expect(maskIdentity("ayse")).toBe("a***");
    expect(maskIdentity("")).toBe("***");
    expect(deletedUserLabel("01J0000000000000000000ABCDEF")).toBe("Silinmiş kullanıcı #ABCDEF");
    expect(deletedTenantLabel("01J0000000000000000000ABCDEF")).toBe("Silinmiş firma #ABCDEF");
    for (const k of ["email", "fullName", "username", "name", "contactName", "phone", "customerName", "customerEmail", "recipient"])
      expect(AUDIT_IDENTITY_KEYS.has(k)).toBe(true);
    expect(AUDIT_ENTITY.USERS).toBe("users");
  });

  it("AC-241 includeDeleted sorgusu boolean'a çevrilir", () => {
    expect(userOptionsQuerySchema.parse({ includeDeleted: "1" }).includeDeleted).toBe(true);
    expect(userOptionsQuerySchema.parse({}).includeDeleted).toBe(false);
    expect(userOptionsQuerySchema.safeParse({ includeDeleted: "yes" }).success).toBe(false);
  });

  it("AC-242 firma silme girdisi: dryRun true yalnız; false → previewId + confirmName", () => {
    expect(tenantPurgeInputSchema.safeParse({ dryRun: true }).success).toBe(true);
    expect(tenantPurgeInputSchema.safeParse({ dryRun: true, previewId: "x".repeat(20) }).success).toBe(false);
    expect(tenantPurgeInputSchema.safeParse({ dryRun: false, confirmName: "Firma" }).success).toBe(false);
    expect(tenantPurgeInputSchema.safeParse({ dryRun: false, previewId: "abcDEF0123456789._-", confirmName: "Firma" }).success).toBe(true);
    expect(purgeJobsQuerySchema.parse({ open: "1" }).open).toBe(true);
    expect(TENANT_PURGE_STEPS).toHaveLength(18);
    expect(TENANT_PURGE_STEPS[0]).toBe("FENCE");
    expect(TENANT_PURGE_STEPS.at(-1)).toBe("DONE");
  });

  it("AC-237/242 hata kodları, eylemler ve etiketler", () => {
    expect(ERROR_STATUS.PURGE_NOT_ELIGIBLE).toBe(409);
    expect(ERROR_STATUS.PREVIEW_REQUIRED).toBe(428);
    const actions = [
      USER_AUDIT.DELETED,
      ...Object.values(TENANT_PURGE_AUDIT),
      UPLOADS_AUDIT.ORPHAN_SCAN,
      MIGRATION_AUDIT.P16_USERS_DELETE_RESET,
    ];
    expect(actions).toContain("migration.p16_users_delete_reset");
    for (const a of actions) expect(P16_AUDIT_LABELS[a]).toBeTruthy();
    const prefixes = AUDIT_ACTION_GROUPS.map((g) => g.prefix);
    for (const a of actions) expect(prefixes).toContain(`${a.split(".")[0]}.*`);
    expect(PERMISSION_DESCRIPTIONS["users.delete"]).toContain("Pasif kullanıcıyı kalıcı siler (geri alınamaz)");
  });
});
