// P27 test yardımcıları: doğrudan DB'ye gözetimsiz cihaz / grant / adres / cihaz oturumu (API dışı kurulum).
import { randomBytes } from "node:crypto";
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import type { DeviceLink } from "../../src/unattended/service.ts";
import { testDb } from "./app.ts";

export const SHA = "ab".repeat(32);

export async function createDeviceRow(o: {
  tenantId: string;
  customerId: string;
  name?: string;
  signed?: boolean;
  sha256?: string;
  localEnabled?: boolean;
  verified?: boolean;
}) {
  const id = newId();
  await testDb().unattendedDevice.create({
    data: {
      id,
      tenantId: o.tenantId,
      customerId: o.customerId,
      name: o.name ?? `PC-${id.slice(-6)}`,
      publicKey: randomBytes(32),
      osVersion: "Windows 11 Pro 23H2",
      agentVersion: "1.0.0",
      binarySha256: o.sha256 ?? SHA,
      signed: o.signed ?? false,
      localEnabled: o.localEnabled ?? true,
      registeredIp: "198.51.100.7",
      lastIp: "198.51.100.7",
      ...(o.verified ? { verifiedAt: new Date() } : {}),
    },
  });
  return id;
}

export async function grantRow(tenantId: string, deviceId: string, userId: string): Promise<void> {
  await testDb().unattendedDeviceGrant.create({ data: { id: newId(), tenantId, deviceId, userId } });
}

export async function contactRow(tenantId: string, customerId: string, email = `m-${newId().toLowerCase()}@musteri.test`): Promise<string> {
  await testDb().customerNotifyContact.create({ data: { id: newId(), tenantId, customerId, email } });
  return email;
}

/** Bitmiş gözetimsiz oturum (cihaza bağlı; firma silme sırası testleri). */
export async function deviceSessionRow(tenantId: string, technicianId: string, deviceId: string): Promise<string> {
  const id = newId();
  const now = new Date();
  await testDb().supportSession.create({
    data: {
      id,
      tenantId,
      technicianId,
      deviceId,
      tokenHash: sha256Hex(newSecretToken()),
      techVerifyCode: "1234",
      status: "ENDED",
      mode: "UNATTENDED",
      consumedAt: now,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      endedAt: now,
      endedBy: "SYSTEM",
      endReason: "ended",
      customerName: "PC-1",
    },
  });
  return id;
}

/** Sahte canlı kanal: çevrimiçi kümesi + çağrı kaydı (K3 hub yerine). */
export function fakeLink(online: string[] = []): DeviceLink & { calls: string[]; online(id: string): void } {
  const calls: string[] = [];
  const set = new Set(online);
  return {
    calls,
    online: (id) => void set.add(id),
    onlineIds: () => [...set],
    isOnline: (id) => set.has(id),
    has: (id) => set.has(id), // r3: sahte çevrimiçi cihaz güncel servis (`direct1`) sayılır
    replacedAlert: () => false,
    revoked: (id) => calls.push(`revoked:${id}`),
    grantsRemoved: (id, users) => calls.push(`grants:${id}:${[...users].sort().join(",")}`),
  };
}

/** Firma SMTP kaydı (smtp.test:2525 → süreç içi sahte SMTP; `loopbackNetguard` + `inboxTransport`). */
export async function setSmtp(tenantId: string, fromEmail = "destek@firma.test"): Promise<void> {
  await testDb().tenantSettings.update({
    where: { tenantId },
    data: { smtpHost: "smtp.test", smtpPort: 2525, smtpSecurity: "NONE", smtpFromEmail: fromEmail },
  });
}

/** P27 uygulama env'i (staging + imzasız mod). */
export const UNSIGNED_ENV = { UNATTENDED_MODE: "unsigned", DEPLOY_ENV: "staging" } as const;

/** Kayıt kodu satırı (varsayılan bekleyen; TTL CHECK: expires = created + 24 sa); yalnız id döner — düz kod yok. */
export async function codeRow(tenantId: string, customerId: string, o: { usedDeviceId?: string; createdAt?: Date } = {}): Promise<string> {
  const id = newId();
  const createdAt = o.createdAt ?? new Date();
  await testDb().unattendedRegistrationCode.create({
    data: {
      id,
      tenantId,
      customerId,
      codeHash: sha256Hex(id),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
      ...(o.usedDeviceId ? { usedAt: createdAt, deviceId: o.usedDeviceId } : {}),
    },
  });
  return id;
}
