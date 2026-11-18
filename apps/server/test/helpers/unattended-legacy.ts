// P28u r3 (AC-451) eski kayıt fikstürü: r3 öncesi `asked` / `silent` oturum satırı + o dönemin audit satırları doğrudan DB'ye
// yazılır (sunucu artık bu kipleri üretmez). Yalnız okuma yollarını (geçmiş, audit, maske) sınamak için.
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import { testDb } from "./app.ts";
import type { Ready } from "./unattended-device.ts";

export const LEGACY_REASON = "Müşteri sunucusu gece yanıt vermiyor, acil müdahale.";

/** Biten eski gözetimsiz oturum + `unattended.connect` / `session.started` / `session.ended` (+ asked'ta `unattended.consent`). */
export async function legacySession(
  r: Pick<Ready, "tenantId" | "customerId" | "tech" | "dev">,
  mode: "asked" | "silent",
  endReason = "tech",
): Promise<string> {
  const id = newId();
  const now = new Date(Date.now() - 60_000);
  await testDb().supportSession.create({
    data: {
      id,
      tenantId: r.tenantId,
      technicianId: r.tech.id,
      deviceId: r.dev.id,
      customerId: r.customerId,
      customerName: "PC-ESKI",
      tokenHash: sha256Hex(newSecretToken()),
      techVerifyCode: "1234",
      status: endReason.startsWith("consent_") ? "CANCELLED" : "ENDED",
      // Kabul edilmiş (ENDED) oturumda mode + consumed_at birlikte (support_sessions_consumed_mode_chk); iptalde ikisi de yok.
      ...(endReason.startsWith("consent_") ? {} : { mode: "UNATTENDED", consumedAt: new Date(now.getTime() + 1_000) }),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      endedAt: new Date(),
      endedBy: "SYSTEM",
      endReason,
      consentMode: mode,
      ...(mode === "silent" ? { silentReason: LEGACY_REASON } : {}),
    },
  });
  const base = { tenantId: r.tenantId, entity: "support_sessions", entityId: id, result: "success" };
  const rows = [
    {
      ...base,
      userId: r.tech.id,
      username: r.tech.email,
      action: "unattended.connect",
      newValue: mode === "silent" ? { deviceId: r.dev.id, consentMode: "silent", silentReason: LEGACY_REASON } : { deviceId: r.dev.id, consentRequested: "ask" },
    },
    { ...base, username: "device", action: "unattended.session.started", newValue: { deviceId: r.dev.id, consentMode: mode } },
    { ...base, username: "system", action: "unattended.session.ended", newValue: { deviceId: r.dev.id, consentMode: mode, endReason } },
    ...(mode === "asked"
      ? [{ ...base, username: `device:${r.dev.id}`, action: "unattended.consent", newValue: { consentMode: "asked", decision: "granted", ms: 900 } }]
      : [{ ...base, userId: r.tech.id, username: r.tech.email, action: "unattended.silent.notify", newValue: { event: "connect", recipient: "a***@x.test", result: "success", attempt: 1 } }]),
  ];
  await testDb().auditLog.createMany({ data: rows });
  return id;
}
