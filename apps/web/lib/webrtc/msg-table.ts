import type { ServerOutbound } from "@remote/contracts/ws";

/** Sunucu mesajının tipi `K` olan dalı. */
export type MsgOf<K extends ServerOutbound["t"]> = Extract<ServerOutbound, { t: K }>;
/** Saf makinelerin sunucu mesajı işleyici tablosu: mesaj tipi başına bir işlev (tabloda olmayan tip durumu değiştirmez). */
export type MsgTable<S> = { [K in ServerOutbound["t"]]?: (s: S, m: MsgOf<K>, now: number) => S };

export function applyMsg<S>(table: MsgTable<S>, s: S, m: ServerOutbound, now: number): S {
  const h = table[m.t] as ((s: S, m: ServerOutbound, now: number) => S) | undefined;
  return h ? h(s, m, now) : s;
}
