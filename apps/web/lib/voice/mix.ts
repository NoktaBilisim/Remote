/*
 * P28d misafir mix-minus planı — saf (mimari-p28d r2 §4.3, ADR-0036 m.4; AC-378, D-PD-3, Y-PD-3).
 *  - Talker kapısı: WebAudio grafına YALNIZ `talkers` içindeki (ve eşi/uzak izi olan) tid kaynak olarak girer.
 *  - Hoparlör: Σ talkers.
 *  - Teknisyen t'ye giden karışım: mikrofon + Σ(talkers \ {t}) — alıcının kendi sesi hariç.
 *  - Gönderim kapısı: karışım yalnız `listeners` eşlerine; diğer eşlerin ses göndericisi `replaceTrack(null)`.
 * Kenar biçimi `kaynak>hedef`: kaynak "mic" ya da tid; hedef "speaker" ya da tid.
 */
export const MIC = "mic";
export const SPEAKER = "speaker";

export interface MixInput {
  talkers: readonly string[];
  listeners: readonly string[];
  /** Eşi kurulu (ses alıcısı olan) tid'ler. */
  peers: readonly string[];
}

export interface MixPlan {
  /** Bağlanacak kenarlar (`kaynak>hedef`), sıralı ve benzersiz. */
  edges: string[];
  /** Eş başına: karışım gönderilir mi (`listeners ∋ tid`). */
  send: Record<string, boolean>;
}

export const edge = (from: string, to: string): string => `${from}>${to}`;

export function mixPlan(p: MixInput): MixPlan {
  const peers = new Set(p.peers);
  const sources = p.talkers.filter((t) => peers.has(t));
  const out: string[] = [];
  for (const s of sources) out.push(edge(s, SPEAKER));
  const send: Record<string, boolean> = {};
  for (const t of p.peers) {
    send[t] = p.listeners.includes(t);
    if (!send[t]) continue;
    out.push(edge(MIC, t));
    for (const s of sources) if (s !== t) out.push(edge(s, t));
  }
  return { edges: [...new Set(out)].sort(), send };
}

/** İki plan arası fark: kopacak ve bağlanacak kenarlar (aynı tikte uygulanır — talkers'tan çıkan tid hemen kopar). */
export function diffEdges(before: readonly string[], after: readonly string[]): { drop: string[]; add: string[] } {
  const a = new Set(after);
  const b = new Set(before);
  return { drop: before.filter((e) => !a.has(e)), add: after.filter((e) => !b.has(e)) };
}
