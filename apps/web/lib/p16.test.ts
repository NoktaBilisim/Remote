import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { actionLabel, actionOptionGroups, auditActor, groupLabel } from "@/lib/audit/actions";
import {
  PURGE_STEP_LABELS,
  TENANT_PURGE_STEPS,
  TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE,
  isReactivatePurgeConflict,
  purgeCountRows,
  purgeEligibility,
  purgeErrorLabel,
  purgeErrorOf,
  purgeProgress,
  purgeRemainingMs,
} from "@/lib/tenants/purge";
import { userDeleteErrorOf, userDeleteState } from "@/lib/users/delete";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-15T10:00:00Z");
const err = (status: number, code: string, message = "", fields?: Record<string, string>) =>
  new ApiError(status, code, message, fields, "req1");

describe("AC-242: firma silme uygunluğu ve durum yardımcıları", () => {
  it("aktif firma silinemez; pasiflik 30 günü dolmadıysa tarih; dolduysa ya da bilinmiyorsa açık", () => {
    expect(purgeEligibility({ status: "ACTIVE", passiveSince: null }, NOW)).toEqual({ kind: "active" });
    const since = new Date(NOW - 10 * DAY).toISOString();
    expect(purgeEligibility({ status: "PASSIVE", passiveSince: since }, NOW)).toEqual({
      kind: "wait",
      eligibleAt: new Date(NOW + 20 * DAY).toISOString(),
    });
    expect(purgeEligibility({ status: "PASSIVE", passiveSince: new Date(NOW - 31 * DAY).toISOString() }, NOW)).toEqual({
      kind: "eligible",
    });
    expect(purgeEligibility({ status: "PASSIVE" }, NOW)).toEqual({ kind: "eligible" });
  });
  it("her adımın Türkçe etiketi var; ilerleme 1 tabanlı, DONE %100", () => {
    for (const s of TENANT_PURGE_STEPS) expect(PURGE_STEP_LABELS[s]).toBeTruthy();
    expect(purgeProgress({ state: "RUNNING", step: "SESSIONS", stepIndex: 5, stepCount: 17 })).toEqual({
      current: 6,
      total: 17,
      pct: 31,
      label: "Destek oturumları",
    });
    expect(purgeProgress({ state: "DONE", step: "DONE", stepIndex: 16, stepCount: 17 }).pct).toBe(100);
  });
  it("önizleme sayımları adım sırasıyla; bilinmeyen anahtar sona ham", () => {
    const rows = purgeCountRows({ USERS: 3, SESSIONS: 10, ...({ X_NEW: 1 } as object) });
    expect(rows.map((r) => r.label)).toEqual(["Destek oturumları", "Kullanıcılar", "X_NEW"]);
  });
  it("geri sayım: hidrasyon öncesi null, geçmişte 0", () => {
    expect(purgeRemainingMs(new Date(NOW + 5000).toISOString(), null)).toBeNull();
    expect(purgeRemainingMs(new Date(NOW + 5000).toISOString(), NOW)).toBe(5000);
    expect(purgeRemainingMs(new Date(NOW - 5000).toISOString(), NOW)).toBe(0);
  });
  it("hata eşlemesi: ad alanı, 428 önizleme, uygun değil (tarih), açık iş çakışması", () => {
    expect(purgeErrorOf(err(400, "VALIDATION", "", { confirmName: "Eşleşmiyor" }))).toEqual({ kind: "field", message: "Eşleşmiyor" });
    expect(purgeErrorOf(err(428, "PREVIEW_REQUIRED", "x")).kind).toBe("preview");
    expect(purgeErrorOf(err(409, "PURGE_NOT_ELIGIBLE", "m", { eligibleAt: "2026-12-01T00:00:00Z" }))).toEqual({
      kind: "notEligible",
      eligibleAt: "2026-12-01T00:00:00Z",
      message: "m",
    });
    expect(purgeErrorOf(err(409, "CONFLICT", "Açık iş", { jobId: "j", state: "SCHEDULED" })).kind).toBe("refresh");
    expect(purgeErrorOf(err(500, "INTERNAL")).kind).toBe("other");
    expect(purgeErrorOf(new Error("x")).kind).toBe("other");
  });
  it("yeniden etkinleştirme 409'u silme işinden ayrılır; hata sınıfı etiketi", () => {
    expect(isReactivatePurgeConflict(err(409, "CONFLICT", TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE))).toBe(true);
    expect(isReactivatePurgeConflict(err(409, "CONFLICT", "Firma zaten aktif"))).toBe(false);
    expect(purgeErrorLabel("db_fk")).toBe("veritabanı bağımlılık hatası");
    expect(purgeErrorLabel("yeni")).toBe("yeni");
    expect(purgeErrorLabel(null)).toBe("beklenmeyen hata");
  });
});

describe("AC-241: kullanıcı kalıcı silme", () => {
  const u = { status: "PASSIVE" as const, canManage: true, isSelf: false };
  it("düğme: yetki/yönetim/kendi hesabı → yok; aktif → pasif + neden; pasif → açık", () => {
    expect(userDeleteState(u, ["users.view"])).toBe("hidden");
    expect(userDeleteState({ ...u, canManage: false }, ["users.delete"])).toBe("hidden");
    expect(userDeleteState({ ...u, isSelf: true }, ["users.delete"])).toBe("hidden");
    expect(userDeleteState({ ...u, status: "ACTIVE" }, ["users.delete"])).toBe("needsPassive");
    expect(userDeleteState(u, ["users.delete"])).toBe("enabled");
  });
  it("hata eşlemesi: ad alanı, bayat kayıt, 404, 409 mesajı", () => {
    expect(userDeleteErrorOf(err(400, "VALIDATION", "", { confirmName: "Eşleşmiyor" }), "nf")).toEqual({
      kind: "field",
      message: "Eşleşmiyor",
    });
    expect(userDeleteErrorOf(err(409, "STALE_WRITE", "x"), "nf")?.kind).toBe("stale");
    expect(userDeleteErrorOf(err(428, "PRECONDITION_REQUIRED", "x"), "nf")?.kind).toBe("stale");
    expect(userDeleteErrorOf(err(404, "NOT_FOUND"), "nf")).toEqual({ kind: "message", message: "nf" });
    expect(userDeleteErrorOf(err(409, "CONFLICT", "Önce kullanıcıyı pasife alın"), "nf")).toEqual({
      kind: "message",
      message: "Önce kullanıcıyı pasife alın",
    });
    expect(userDeleteErrorOf(err(500, "INTERNAL"), "nf")).toBeNull();
  });
});

describe("AC-241/243: audit P16 etiketleri ve maskeli aktör", () => {
  it("P16 eylemleri Türkçe; uploads.* ve migration.* filtre grupları", () => {
    expect(actionLabel("user.deleted")).toBe("Kullanıcı kalıcı silindi");
    expect(actionLabel("tenant.purge_scheduled")).toBe("Firma silme zamanlandı");
    expect(groupLabel("uploads")).toBe("Dosya deposu");
    const labels = actionOptionGroups().map((g) => g.label);
    expect(labels).toContain("Dosya deposu");
    expect(labels).toContain("Veritabanı geçişi");
  });
  it("aktör: actorLabel önce; silinmiş kullanıcı mezar taşı; eski kayıtta userFullName", () => {
    const id = "01JKS00000000000000000ABCD";
    expect(auditActor({ userId: id, username: "a***@***", userFullName: null, actorLabel: "Silinmiş kullanıcı #00ABCD" })).toEqual({
      name: "Silinmiş kullanıcı #00ABCD",
      tombstone: true,
    });
    expect(auditActor({ userId: id, username: "x@y", userFullName: "Ali", actorLabel: "Ali" })).toEqual({ name: "Ali", tombstone: false });
    expect(auditActor({ userId: null, username: "system", userFullName: null })).toEqual({ name: "system", tombstone: false });
  });
});
