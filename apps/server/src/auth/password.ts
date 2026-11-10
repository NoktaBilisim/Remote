// Şifre hash'i (mimari §5.1, AC-64): argon2id m=19 MiB, t=2, p=1 — prisma/seed.ts ile aynı.
import argon2 from "argon2";
import { newSecretToken } from "../lib/ids.ts";

const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, ARGON2_OPTIONS);

let dummyHash: Promise<string> | undefined;

/** Kullanıcı yoksa da aynı maliyette doğrulama yapılır (zamanlama ile hesap varlığı sızmaz). */
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (hash === null) {
    dummyHash ??= hashPassword(newSecretToken());
    await argon2.verify(await dummyHash, password);
    return false;
  }
  return argon2.verify(hash, password);
}
