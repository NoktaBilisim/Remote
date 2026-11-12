// Bildirim merkezi (mimari-e9 §2, §3.5; ADR-0016 §2, §4). Tek instance, bellek içi (ADR-0005). DB'ye yazmaz.
//  - `/ws/request`: talep başına tek soket (yeni bağlantı eskisini 4409 ile kapatır), ipKey başına açık soket sayımı,
//    kuyruk değişince `request.state` (tenant başına ≤ 1/sn birleştirilir) + 10 sn yenileme (AC-139).
//  - `/ws/panel`: tenant → kullanıcı soketleri (kullanıcı başına ≤ 5), olay yayını, `closeByUser`/`closeByAuthToken` (G-E9-14).
// Çok instance genişlemesi: dışa yalnız publish/sendToUser/sendToRequest açılır (Redis pub/sub bu dosyanın arkasına).
import type { PanelOutbound, RequestOutbound } from "@remote/contracts/ws-request";
import { LEGACY_CANCEL_REASONS, WS_REQUEST_CLOSE } from "@remote/contracts/ws-request";
import type { Clock } from "../signaling/types.ts";

export interface JsonPeer<T> {
  send(msg: T): void;
  close(code: number, reason: string): void;
  isOpen(): boolean;
}

export interface RequestConn {
  peer: JsonPeer<RequestOutbound>;
  requestId: string;
  tenantId: string;
  ipKey: string;
  /** Güvenilen CIDR kaynağı: ipKey başına eşzamanlı soket sınırından muaf (G-E9-16, koordinatör kararı b). */
  trusted: boolean;
  /** P8c (mimari-e10 §5.4): 0.9.x istemci — `request.closed.reason` yalnız eski küme; yeni nedenler TENANT_PASSIVE'e eşlenir. */
  legacy?: boolean;
}

/** 0.9.x'e giden `request.closed`: bilinmeyen neden → TENANT_PASSIVE (DB'de gerçek neden kalır). */
export function legacyClosed(msg: RequestOutbound): RequestOutbound {
  if (msg.t !== "request.closed" || msg.reason === undefined || (LEGACY_CANCEL_REASONS as readonly string[]).includes(msg.reason)) return msg;
  return { ...msg, reason: "TENANT_PASSIVE" };
}

export interface PanelConn {
  peer: JsonPeer<PanelOutbound>;
  userId: string;
  /** SHA-256(çerez değeri) — düz token bellekte de tutulmaz (closeByAuthToken eşleşmesi). */
  tokenHash: string;
  /** Yeniden doğrulama için çerez değeri (yalnız bellekte; loglanmaz). */
  token: string;
  tenantId: string;
}

export type RequestStatePayload = Omit<Extract<RequestOutbound, { t: "request.state" }>, "t" | "serverTime">;

export const PANEL_SOCKETS_PER_USER = 5;
export const REQUEST_SOCKETS_PER_IP = 5;
const COALESCE_MS = 1_000;
const REFRESH_MS = 10_000;

export class RequestHub {
  private readonly requests = new Map<string, RequestConn>();
  private readonly ipOpen = new Map<string, number>();
  private readonly panels = new Map<string, Set<PanelConn>>();
  private readonly disconnectTimers = new Map<string, unknown>();
  private readonly dirty = new Map<string, unknown>();
  private readonly refresh: NodeJS.Timeout;
  private readonly clock: Clock;
  private readonly statesOf: (tenantId: string) => Promise<Map<string, RequestStatePayload>>;
  private readonly onError: (err: unknown) => void;

  constructor(clock: Clock, statesOf: (tenantId: string) => Promise<Map<string, RequestStatePayload>>, onError: (err: unknown) => void, refreshMs = REFRESH_MS) {
    this.clock = clock;
    this.statesOf = statesOf;
    this.onError = onError;
    this.refresh = setInterval(() => {
      for (const t of new Set([...this.requests.values()].map((c) => c.tenantId))) void this.pushStates(t);
    }, refreshMs);
    this.refresh.unref();
  }

  get requestCount(): number {
    return this.requests.size;
  }
  get panelCount(): number {
    let n = 0;
    for (const s of this.panels.values()) n += s.size;
    return n;
  }

  // ---------------- /ws/request ----------------

  /** ipKey'in açık (güvenilmeyen) soket sayısı sınırı aşılacak mı (G-E9-9). */
  ipFull(ipKey: string): boolean {
    return (this.ipOpen.get(ipKey) ?? 0) >= REQUEST_SOCKETS_PER_IP;
  }

  attachRequest(conn: RequestConn): void {
    const old = this.requests.get(conn.requestId);
    this.requests.set(conn.requestId, conn);
    if (!conn.trusted) this.ipOpen.set(conn.ipKey, (this.ipOpen.get(conn.ipKey) ?? 0) + 1);
    this.clearDisconnect(conn.requestId);
    if (old) {
      this.release(old);
      old.peer.close(WS_REQUEST_CLOSE.REPLACED, "replaced");
    }
  }

  private release(conn: RequestConn): void {
    if (conn.trusted) return;
    const n = (this.ipOpen.get(conn.ipKey) ?? 1) - 1;
    if (n <= 0) this.ipOpen.delete(conn.ipKey);
    else this.ipOpen.set(conn.ipKey, n);
  }

  /** Soket kapandı. Güncel soketse true (çağıran kopma kuralını uygular), değiştirilmiş eski soketse false. */
  detachRequest(conn: RequestConn): boolean {
    if (this.requests.get(conn.requestId) !== conn) return false;
    this.requests.delete(conn.requestId);
    this.release(conn);
    return true;
  }

  isAttached(conn: RequestConn): boolean {
    return this.requests.get(conn.requestId) === conn;
  }

  sendToRequest(requestId: string, msg: RequestOutbound): boolean {
    const c = this.requests.get(requestId);
    if (!c) return false;
    c.peer.send(msg);
    return true;
  }

  /** Son mesaj sonrası kapatır (request.closed + 1000). */
  closeRequest(requestId: string, msg: RequestOutbound, code = 1000): void {
    const c = this.requests.get(requestId);
    this.clearDisconnect(requestId);
    if (!c) return;
    this.requests.delete(requestId);
    this.release(c);
    c.peer.send(c.legacy ? legacyClosed(msg) : msg);
    c.peer.close(code, "closed");
  }

  setDisconnect(requestId: string, fn: () => void, ms: number): void {
    this.clearDisconnect(requestId);
    this.disconnectTimers.set(
      requestId,
      this.clock.setTimeout(() => {
        this.disconnectTimers.delete(requestId);
        fn();
      }, ms),
    );
  }

  clearDisconnect(requestId: string): void {
    const t = this.disconnectTimers.get(requestId);
    if (t === undefined) return;
    this.clock.clearTimeout(t);
    this.disconnectTimers.delete(requestId);
  }

  /** Tenant kuyruğu değişti: `request.state` ≤ 1/sn birleştirilerek gönderilir. */
  queueChanged(tenantId: string): void {
    if (this.dirty.has(tenantId)) return;
    this.dirty.set(
      tenantId,
      this.clock.setTimeout(() => {
        this.dirty.delete(tenantId);
        void this.pushStates(tenantId);
      }, COALESCE_MS),
    );
  }

  async pushStates(tenantId: string): Promise<void> {
    const conns = [...this.requests.values()].filter((c) => c.tenantId === tenantId);
    if (conns.length === 0) return;
    try {
      const states = await this.statesOf(tenantId);
      const serverTime = new Date(this.clock.now()).toISOString();
      for (const c of conns) {
        const s = states.get(c.requestId);
        if (s && this.requests.get(c.requestId) === c) c.peer.send({ t: "request.state", ...s, serverTime });
      }
    } catch (err) {
      this.onError(err);
    }
  }

  // ---------------- /ws/panel ----------------

  /** false → kullanıcının açık soket sınırı dolu (çağıran 4429 ile kapatır). */
  addPanel(conn: PanelConn): boolean {
    const set = this.panels.get(conn.tenantId) ?? new Set<PanelConn>();
    if ([...set].filter((c) => c.userId === conn.userId).length >= PANEL_SOCKETS_PER_USER) return false;
    set.add(conn);
    this.panels.set(conn.tenantId, set);
    return true;
  }

  removePanel(conn: PanelConn): void {
    const set = this.panels.get(conn.tenantId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.panels.delete(conn.tenantId);
  }

  panelConns(): PanelConn[] {
    return [...this.panels.values()].flatMap((s) => [...s]);
  }

  /** Tenant'ın tüm panel soketlerine (anahtar soket bağlamındaki tenant; mesajda tenant parametresi yok — T35). */
  publish(tenantId: string, msg: PanelOutbound): void {
    for (const c of this.panels.get(tenantId) ?? []) c.peer.send(msg);
  }

  sendToUser(tenantId: string, userId: string, msg: PanelOutbound): void {
    for (const c of this.panels.get(tenantId) ?? []) if (c.userId === userId) c.peer.send(msg);
  }

  private closePanels(pred: (c: PanelConn) => boolean): number {
    let n = 0;
    for (const c of this.panelConns()) {
      if (!pred(c)) continue;
      this.removePanel(c);
      c.peer.close(WS_REQUEST_CLOSE.AUTH_REVOKED, "auth_revoked");
      n++;
    }
    return n;
  }

  /** G-E9-14: şifre değişimi (eski oturumlar), logout-all, deaktivasyon, yetki kaybı → 4401. */
  closeByUser(userId: string): number {
    return this.closePanels((c) => c.userId === userId);
  }

  /** G-E9-14: logout (o token). `tokenHash` = SHA-256(çerez). */
  closeByAuthToken(tokenHash: string): number {
    return this.closePanels((c) => c.tokenHash === tokenHash);
  }

  closePanel(conn: PanelConn): void {
    this.removePanel(conn);
    conn.peer.close(WS_REQUEST_CLOSE.AUTH_REVOKED, "auth_revoked");
  }

  shutdown(): void {
    clearInterval(this.refresh);
    for (const t of this.disconnectTimers.values()) this.clock.clearTimeout(t);
    for (const t of this.dirty.values()) this.clock.clearTimeout(t);
    this.disconnectTimers.clear();
    this.dirty.clear();
  }
}
