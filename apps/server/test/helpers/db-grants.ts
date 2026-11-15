// PT-K2: veri katmanı (CHECK / tetikleyici / yetki) testlerinin ortak başı — ret metni, geri alınan TX, satır
// sonlandırıcılar. Saf yardımcılar; DB bağlantısını çağıran verir.
import { expect } from "vitest";
import type { Db } from "../../src/lib/db.ts";

/** Reddedilmesi beklenen sorgunun hata metni (mesaj + Prisma `meta`); reddedilmezse beklenti düşer. */
export async function errorText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "reddedilmeliydi").toBeInstanceOf(Error);
  return `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
}

/** Hata mesajında beklenen kısıt adı (CHECK 3819 / FK 1452 / yetki 1142). */
export async function rejectsWith(p: Promise<unknown>, needle: string | RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `reddedilmeliydi: ${String(needle)}`).toBeInstanceOf(Error);
  const text = `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
  expect(text).toMatch(needle);
}

/** Tek bağlantıda (etkileşimli TX) çalıştırır ve her durumda geri alır; oturum değişkenleri sıfırlanır. */
export async function inRolledBackTx(db: Db, fn: (tx: Pick<Db, "$executeRawUnsafe" | "$queryRawUnsafe">) => Promise<void>) {
  const ROLLBACK = new Error("rollback");
  await db
    .$transaction(async (tx) => {
      try {
        await fn(tx);
      } finally {
        await tx.$executeRawUnsafe("SET TIMESTAMP = DEFAULT, time_zone = DEFAULT");
      }
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
}

// ICU `$` girdinin sonundaki TEK satır sonlandırıcıdan önce de eşleşiyordu (8.4.13'te denendi); `\z` hepsini reddeder.
export const TERMINATORS = {
  LF: "\n",
  CR: "\r",
  CRLF: "\r\n",
  VT: "\v",
  FF: "\f",
  NEL: "\u0085",
  LS: " ",
  PS: " ",
};
