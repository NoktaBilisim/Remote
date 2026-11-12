// P8c bilgisayar kaydı WS adımları (mimari-protokol §6, ADR-0017 §2, mimari-e10 §3.4, §5.4). `hello` şeması DEĞİŞMEZ;
// teklif yalnız admit edilmiş AGENT misafire ve istemci sürümü ≥ 0.10.0 ise (0.9.x hiçbir `binding.*` almaz).
// Kabul sırası (protokol §6): ADMITTED değil → 1008 (handlers.ts); BROWSER → FORBIDDEN; teklifsiz bağlantı → CONFLICT;
// oturum başına 3'ü aşan → RATE_LIMITED; sonra servis (ACTIVE/tenant/müşteri/bayat kaynak → CONFLICT).
import { BINDING_ISSUE_PER_SESSION, BINDING_MIN_CLIENT_VERSION } from "@remote/contracts/api/bindings";
import type { ServerOutbound } from "@remote/contracts/ws";
import { compareVersions } from "../lib/version.ts";
import type { Rooms } from "./rooms.ts";
import type { Guest, Peer, Room } from "./types.ts";

export type IssueOutcome = { ok: true; msg: Extract<ServerOutbound, { t: "binding.issued" }> } | { ok: false; message: string };

/** `hello` (admit ve yeniden bağlanma) hemen ardından; teklif bağlantıya işlenir. */
export function offerBinding(rooms: Rooms, guest: Guest): void {
  if (!rooms.bindingIssuer || guest.kind !== "AGENT" || !guest.peer) return;
  if (compareVersions(guest.clientVersion ?? "0.0.0", BINDING_MIN_CLIENT_VERSION) < 0) return;
  guest.bindingOfferPeer = guest.peer;
  guest.peer.send({ t: "binding.offer" });
}

export async function handleBindingRequest(rooms: Rooms, room: Room, guest: Guest, peer: Peer, previousKey: string | undefined): Promise<void> {
  if (guest.kind !== "AGENT") {
    rooms.metrics.inc("rs_binding_denied_total", { reason: "browser" });
    peer.send({ t: "error", code: "FORBIDDEN", message: "Bilgisayar kaydı yalnız istemci uygulamasında verilir." });
    return;
  }
  if (!rooms.bindingIssuer || guest.bindingOfferPeer !== peer) {
    rooms.metrics.inc("rs_binding_denied_total", { reason: "no_offer" });
    peer.send({ t: "error", code: "CONFLICT", message: "Kayıt teklifi yok." });
    return;
  }
  room.bindingRequests = (room.bindingRequests ?? 0) + 1;
  if (room.bindingRequests > BINDING_ISSUE_PER_SESSION) {
    rooms.metrics.inc("rs_binding_denied_total", { reason: "rate" }); // B-P8c-4
    peer.send({ t: "error", code: "RATE_LIMITED", message: "Çok fazla kayıt isteği." });
    return;
  }
  try {
    const out = await rooms.bindingIssuer(room, guest, previousKey);
    if (out.ok) peer.send(out.msg); // yalnız isteyen sokete; anahtar başka mesajda/logda yok
    else peer.send({ t: "error", code: "CONFLICT", message: out.message });
  } catch (err) {
    rooms.log.error({ err, event: "binding_issue" }, "kayıt verilemedi");
    peer.send({ t: "error", code: "INTERNAL", message: "Kayıt verilemedi." });
  }
}
