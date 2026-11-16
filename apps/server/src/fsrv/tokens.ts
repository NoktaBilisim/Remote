// P28b bellek içi belirteç tablosu (mimari-p28b §4 "Belirteçler", D-P28b-2, K-P28b-26; ADR-0005). 32 bayt rastgele base64url;
// tabloda yalnız SHA-256'sı. Yükleme belirteci: fid + oturum (son parçada / iptalde düşer). İndirme belirteci: fid + oturum +
// tenant + aktör, ≤ 5 dk, süre içinde tekrar kullanılabilir. Oda/katılımcı olaylarında `dropRoom` ile düşer; HISTORY belirteci
// üretenin `authSessionId`'sine bağlıdır; çıkış/pasife alma/şifre değişimi GET anında `resolveSessionById` ile reddedilir
// (bellekten ayrıca düşürülmez — D-P28b-K1-2; belirteç ≤ 5 dk'da kendiliğinden düşer).
import { FSRV_DOWNLOAD_TTL_MS } from "@remote/contracts/ws-fsrv";
import { newSecretToken, sha256Hex } from "../lib/ids.ts";

export type TokenActor =
  { kind: "TECH"; userId: string } | { kind: "CUSTOMER" } | { kind: "HISTORY"; userId: string; authSessionId: string };

export type TokenEntry =
  | { kind: "upload"; fid: string; sessionId: string; tenantId: string }
  | { kind: "download"; fid: string; sessionId: string; tenantId: string; actor: TokenActor; expiresAt: number };

export class TokenTable {
  private readonly map = new Map<string, TokenEntry>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  get size(): number {
    return this.map.size;
  }

  issue(e: TokenEntry): string {
    this.sweep();
    const token = newSecretToken();
    this.map.set(sha256Hex(token), e);
    return token;
  }

  /** Geçerli kayıt; süresi dolmuşsa silinir ve null. */
  get(token: string): TokenEntry | null {
    const k = sha256Hex(token);
    const e = this.map.get(k);
    if (!e) return null;
    if (e.kind === "download" && e.expiresAt <= this.now()) {
      this.map.delete(k);
      return null;
    }
    return e;
  }

  /** Belirli fid'in yükleme belirteci (son parça / iptal). */
  dropUpload(fid: string): void {
    for (const [k, e] of this.map) if (e.kind === "upload" && e.fid === fid) this.map.delete(k);
  }

  /** Fid'in tüm belirteçleri (silinen dosya). */
  dropFid(fid: string): void {
    for (const [k, e] of this.map) if (e.fid === fid) this.map.delete(k);
  }

  /**
   * Oda olayları: `who` verilmezse odanın tüm yükleme + TECH/CUSTOMER indirme belirteçleri (oda kapanışı); "CUSTOMER" misafir
   * çıkarıldı/ayrıldı, "TECH" teknisyen ayrıldı. HISTORY belirteçleri odaya bağlı değildir.
   */
  dropRoom(sessionId: string, who?: "TECH" | "CUSTOMER"): void {
    for (const [k, e] of this.map) {
      if (e.sessionId !== sessionId) continue;
      if (e.kind === "download" && e.actor.kind === "HISTORY") continue;
      if (who === undefined || (e.kind === "download" && e.actor.kind === who)) this.map.delete(k);
    }
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.map) if (e.kind === "download" && e.expiresAt <= t) this.map.delete(k);
  }

  static ttl(now: number): number {
    return now + FSRV_DOWNLOAD_TTL_MS;
  }
}
