/*
 * P28c çoklu teknisyen (mimari-p28c r2 §1.1, §4.4, §4.5; AC-366..368): roster'dan saf kararlar. Teknisyenin "yeri" (oturum
 * sahibi / kontrol sahibi / izleyici) yalnız sunucu roster'ındaki kendi `tid` satırından türetilir — `hello.techRole` yalnız ilk
 * değerdir; oturum devrinde yeni `hello` gelmez (roster gelir). Gönderim kapısı contracts `seatMay` (varsayılan-ret).
 */
import { seatMay, type RosterRole, type TechRole, type TechRosterEntry } from "@remote/contracts/ws-multi";
import type { MessageKey } from "@/lib/i18n";

export interface Seat {
  owner: boolean;
  controller: boolean;
  observer: boolean;
}

/** Tek teknisyenli (eski sunucu / roster yok) oturum: sahip = kontrol sahibi. */
export const SOLE_SEAT: Seat = { owner: true, controller: true, observer: false };

/**
 * Kendi yerim: roster'da `tid` satırı varsa ondan; yoksa `hello.techRole`'den (owner → sahip + kontrol, participant → yalnız
 * katılımcı, observer → izleyici); ikisi de yoksa tek teknisyenli oturum.
 */
export function seatOf(roster: readonly TechRosterEntry[], tid: string | null, techRole: TechRole | null): Seat {
  const me = tid ? roster.find((e) => e.tid === tid) : undefined;
  if (me) return { owner: me.owner, controller: me.role === "controller", observer: me.role === "observer" };
  if (techRole === "participant") return { owner: false, controller: false, observer: false };
  if (techRole === "observer") return { owner: false, controller: false, observer: true };
  return SOLE_SEAT;
}

/** Teknisyen mesajı bu yerden gönderilebilir mi (contracts `ROLE_MAY`, varsayılan-ret). */
export const canSend = (seat: Seat, t: string): boolean => seatMay(t, seat);

/** Rol etiketi anahtarı (müşteriye ve konsola aynı metin). */
export const ROLE_LABEL_KEY: Readonly<Record<RosterRole, MessageKey>> = {
  controller: "mt.role.controller",
  participant: "mt.role.participant",
  observer: "mt.role.observer",
};

/** Roster'da kontrol sahibinin `tid`'i (yoksa null). */
export const controllerTid = (roster: readonly TechRosterEntry[]): string | null =>
  roster.find((e) => e.role === "controller")?.tid ?? null;

/**
 * D-PC-4: sohbet `by` → ad. Konsol adı YALNIZ kendi sunucu roster'ından çözer; `by` yoksa müşterinin kendi mesajıdır,
 * çözülemezse de "Müşteri" (misafir sahte ad uyduramaz).
 */
export function chatAuthor(by: string | undefined, roster: readonly TechRosterEntry[], customer: string): string {
  if (!by) return customer;
  return roster.find((e) => e.tid === by)?.name ?? customer;
}

/** İki roster arasında yeni katılanlar (müşteri bildirimi "<Ad> oturuma katıldı (Rol)"). İlk roster bildirim üretmez. */
export function joinedSince(prev: readonly TechRosterEntry[] | null, next: readonly TechRosterEntry[]): TechRosterEntry[] {
  if (!prev) return [];
  const had = new Set(prev.map((e) => e.tid));
  return next.filter((e) => !had.has(e.tid));
}

/** Roster sıralaması: oturum sahibi önce, sonra kontrol sahibi, katılımcı, izleyici (kararlı, ada göre değil). */
export function sortedRoster(roster: readonly TechRosterEntry[]): TechRosterEntry[] {
  const rank = (e: TechRosterEntry) => (e.owner ? 0 : e.role === "controller" ? 1 : e.role === "participant" ? 2 : 3);
  return [...roster].sort((a, b) => rank(a) - rank(b));
}
