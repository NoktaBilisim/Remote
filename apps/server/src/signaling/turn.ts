// TURN kısa ömürlü credential (coturn `use-auth-secret`, ADR-0007, G-13, AC-21/22):
// username = "<bitiş unix sn>:<sessionId>", credential = base64(HMAC-SHA1(secret, username)).
// Ömür = min(TURN_CRED_TTL_MIN, oturumun kalan süresi). Yalnız admit sonrası üretilir (G-01).
import { createHmac } from "node:crypto";
import type { IceServer } from "@remote/contracts/ws";

export interface TurnConfig {
  urls: readonly string[];
  secret: string | undefined;
  ttlMin: number;
}

export interface IceGrant {
  iceServers: IceServer[];
  /** Credential bitişi (ms); TURN yoksa null (yenileme gerekmez). */
  expiresAt: number | null;
}

function turnCredential(secret: string, username: string): string {
  return createHmac("sha1", secret).update(username).digest("base64");
}

/** `untilMs`: oturumun bitebileceği en geç an (max süre). */
export function iceServersFor(cfg: TurnConfig, sessionId: string, nowMs: number, untilMs: number): IceGrant {
  const stun = cfg.urls.filter((u) => u.startsWith("stun:"));
  const turn = cfg.urls.filter((u) => /^turns?:/.test(u));
  const servers: IceServer[] = stun.length > 0 ? [{ urls: stun }] : [];
  if (turn.length === 0 || !cfg.secret) return { iceServers: servers, expiresAt: null };
  const expiresAt = Math.min(nowMs + cfg.ttlMin * 60_000, Math.max(untilMs, nowMs + 60_000));
  const username = `${Math.floor(expiresAt / 1000)}:${sessionId}`;
  servers.push({ urls: turn, username, credential: turnCredential(cfg.secret, username) });
  return { iceServers: servers, expiresAt };
}
