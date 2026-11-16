// K9 staging istemcisi (runbook §28b.8). YALNIZ staging; doğrudan çalıştırılmaz — sarmalayıcılar
// `deploy/ops/k9-staging-account.sh` (K9_MODE=enroll) ve `deploy/ops/staging-smoke-p28b.sh` (K9_MODE=smoke|restore)
// bu dosyayı stdin'den server konteynerinde koşar: `docker compose exec -T -e K9_… server node --input-type=module - < k9-staging.mjs`
// (bağımlılıklar `ws` ve `@remote/contracts` konteynerin /app/apps/server çalışma dizininden çözülür).
//
// GİZLİ DEĞER KURALI: parola, TOTP tohumu, çerez, belirteç, bağlantı/kod ASLA stderr'e ya da insan okuyan satıra yazılmaz.
// stdout yalnız sarmalayıcıya giden satır protokolüdür:
//   R <metin>   sonuç satırı (sarmalayıcı ekrana basar; yalnız durum/süre/sayaç)
//   S <adım>    son kullanılan TOTP zaman adımı (durum dosyasına; tekrar kullanım reddi için)
//   M <bool>    firmanın test öncesi fileServerMode değeri (geri alma için)
//   I <ulid>    açılan destek oturumu kimliği (geri alma için; gizli değil)
//   F <ulid>    dosya kimliği (log taramasında pozitif kontrol)
//   N <dize>    log taramasında aranacak iğne (dosya adı / belirteç öneki) — sarmalayıcı yalnız 600 dosyaya yazar
//   T <base32>  (enroll) yeni TOTP tohumu — sarmalayıcı doğrudan 600 dosyaya yazar
//   C <kod>     (enroll) kurtarma kodu — sarmalayıcı doğrudan 600 dosyaya yazar
//   OK          her şey tamam (temizlik dahil)
// Hata: stderr'e yalnız `k9: <aşama> başarısız (HTTP <durum> <kod>)` — yanıt gövdesi basılmaz.
import { createHash, createHmac, randomBytes } from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import { WebSocket } from "ws";
import { avEicar } from "@remote/contracts/api/clamav";

const env = (k, req = true) => {
  const v = process.env[k];
  if (req && !v) throw new Stage("girdi", 0, k);
  return v ?? "";
};
class Stage extends Error {
  constructor(stage, status, code) {
    super(stage);
    this.stage = stage;
    this.status = status;
    this.code = code;
  }
}
const out = (line) => process.stdout.write(`${line}\n`);
const R = (t) => out(`R ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODE = env("K9_MODE");
const SITE = env("K9_SITE"); // 185.126.217.99:4450 (Host ve Origin)
const SITE_IP = SITE.split(":")[0];
const ORIGIN = `https://${SITE}`;
const CA = env("K9_CA"); // Caddy `tls internal` kök sertifikası (açık sertifika)
const EDGE = { host: env("K9_EDGE_HOST", false) || "caddy", port: Number(env("K9_EDGE_PORT", false) || 4450) };
const tlsOpts = { ca: CA, checkServerIdentity: (_h, cert) => tls.checkServerIdentity(SITE_IP, cert) };

// ---------- HTTP (Caddy üzerinden; çerez kavanozu bellekte) ----------
const jar = new Map();
function request(method, path, { json, body, headers = {}, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: SITE, origin: ORIGIN, ...headers };
    let payload = body;
    if (json !== undefined) {
      payload = Buffer.from(JSON.stringify(json));
      h["content-type"] = "application/json";
    }
    if (payload) h["content-length"] = String(payload.length);
    if (auth && jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (auth && jar.has("__Host-rs_csrf") && method !== "GET") h["x-csrf-token"] = jar.get("__Host-rs_csrf");
    const req = https.request({ ...EDGE, ...tlsOpts, method, path, headers: h, timeout: 60_000 }, (res) => {
      for (const c of res.headers["set-cookie"] ?? []) {
        const [kv, ...attrs] = c.split(";");
        const i = kv.indexOf("=");
        const k = kv.slice(0, i).trim();
        const v = kv.slice(i + 1).trim();
        if (attrs.some((a) => /max-age=0/i.test(a.trim())) || v === "") jar.delete(k);
        else jar.set(k, v);
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let data = null;
        if ((res.headers["content-type"] ?? "").includes("json") && buf.length) {
          try {
            data = JSON.parse(buf.toString());
          } catch {
            data = null;
          }
        }
        resolve({ status: res.statusCode ?? 0, data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}
async function api(stage, method, path, opts = {}, ok = [200, 201, 202, 204]) {
  const r = await request(method, path, opts);
  if (!ok.includes(r.status)) throw new Stage(stage, r.status, r.data?.error?.code ?? r.data?.code ?? "-");
  return r.data;
}

// ---------- TOTP (RFC 6238, SHA-1, 6 hane, 30 sn) ----------
function base32(s) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let val = 0;
  const o = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = a.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      o.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(o);
}
function totp(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32(secret)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
/** Aynı/eski zaman adımı sunucuda reddedilir: son kullanılan adımdan büyük ilk adımı bekle. */
let lastStep = Number(process.env.K9_LAST_STEP || 0);
async function freshCode(secret) {
  for (;;) {
    const step = Math.floor(Date.now() / 30_000);
    if (step > lastStep && Date.now() % 30_000 < 25_000) {
      lastStep = step;
      out(`S ${step}`);
      return totp(secret, step);
    }
    await sleep(1000);
  }
}

// ---------- Giriş ----------
// Hesap öneki: K9_ (SUPER_ADMIN) ya da K9_TECH_ (demo firmasında ADMIN teknisyen; Super Admin oturum açamaz —
// sessions/service.ts "oturum yalnız kendi firmanızda").
async function login(p = "K9_") {
  const r = await api("login", "POST", "/api/v1/auth/login", {
    json: { login: env(`${p}EMAIL`), password: env(`${p}PASSWORD`) },
    auth: false,
  });
  return r;
}
async function loginFull(p = "K9_", role = "SUPER_ADMIN") {
  jar.clear();
  const r = await login(p);
  if (r.mustChangePassword) throw new Stage("login", 200, "PASSWORD_CHANGE_REQUIRED");
  if (r.mfaSetupRequired) throw new Stage("login", 200, "MFA_SETUP_REQUIRED (önce k9-staging-account.sh)");
  if (r.mfaRequired)
    await api("mfa.verify", "POST", "/api/v1/auth/mfa/verify", { json: { code: await freshCode(env(`${p}TOTP_SECRET`)) } });
  const me = await api("auth.me", "GET", "/api/v1/auth/me");
  if (me.user.role !== role || me.mfa?.stage !== "ok") throw new Stage("auth.me", 200, "ROLE_OR_STAGE");
  for (const k of ["__Host-rs_session", "__Host-rs_csrf"]) if (jar.has(k)) out(`N ${jar.get(k).slice(0, 12)}`);
  return me;
}
async function logout() {
  await request("POST", "/api/v1/auth/logout", { json: {} }).catch(() => undefined);
}

// ---------- enroll: hesap 2FA kurulumu (idempotent) ----------
async function enroll() {
  const p = process.env.K9_ENROLL_PREFIX || "K9_";
  const r = await login(p);
  if (r.mustChangePassword) throw new Stage("login", 200, "PASSWORD_CHANGE_REQUIRED");
  if (r.mfaRequired) {
    if (!process.env[`${p}TOTP_SECRET`]) throw new Stage("mfa", 200, "MFA_ENABLED_NO_SEED");
    await api("mfa.verify", "POST", "/api/v1/auth/mfa/verify", { json: { code: await freshCode(process.env[`${p}TOTP_SECRET`]) } });
    R("2FA: zaten etkin, tohum dosyadaki ile doğrulandı");
  } else if (r.mfaSetupRequired) {
    const s = await api("mfa.setup", "POST", "/api/v1/auth/mfa/setup", { json: {} });
    out(`T ${s.secret}`); // sarmalayıcı enable'dan ÖNCE dosyaya yazar
    await sleep(500);
    const e = await api("mfa.enable", "POST", "/api/v1/auth/mfa/enable", { json: { code: await freshCode(s.secret) } });
    for (const c of e.recoveryCodes ?? []) out(`C ${c}`);
    R(`2FA: kuruldu ve etkinleştirildi (kurtarma kodu ${e.recoveryCodes?.length ?? 0} adet dosyada)`);
  } else {
    R("2FA: gerekmedi (beklenmeyen; SUPER_ADMIN için zorunlu olmalı)");
  }
  const me = await api("auth.me", "GET", "/api/v1/auth/me");
  R(`hesap: rol=${me.user.role} 2fa=${me.mfa?.enabled ? "etkin" : "kapalı"} aşama=${me.mfa?.stage}`);
  await logout();
  out("OK");
}

// ---------- WS ----------
function wsConnect(path, protocols, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${EDGE.host}:${EDGE.port}${path}`, protocols, {
      ...tlsOpts,
      servername: "", // https.request gibi SNI yok: Host bir IP; Caddy `tls internal` IP sertifikasını SNI'siz seçer ("caddy" SNI'si → EPROTO)
      headers: { host: SITE, origin: ORIGIN, ...headers },
      handshakeTimeout: 15_000,
    });
    const msgs = [];
    const waiters = [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      m.__at = performance.now();
      msgs.push(m);
      waiters.splice(0).forEach((w) => w());
    });
    ws.on("unexpected-response", (_q, res) => reject(new Stage(`ws ${path.split("?")[0]}`, res.statusCode, "-")));
    ws.on("error", (e) => reject(new Stage(`ws ${path.split("?")[0]}`, 0, String(e?.code ?? e?.message ?? "ERR").slice(0, 80))));
    ws.on("open", () =>
      resolve({
        ws,
        msgs,
        send: (o) => ws.send(JSON.stringify(o)),
        waitFor: (pred, label, ms = 60_000) =>
          new Promise((res, rej) => {
            const f = typeof pred === "string" ? (m) => m.t === pred : pred;
            const timer = setTimeout(() => rej(new Stage(`bekleme ${label}`, 0, "TIMEOUT")), ms);
            const check = () => {
              const m = msgs.find(f);
              if (!m) return void waiters.push(check);
              msgs.splice(msgs.indexOf(m), 1);
              clearTimeout(timer);
              res(m);
            };
            check();
          }),
      }),
    );
  });
}

// ---------- smoke ----------
const state = { sessionId: null, prior: null, tech: null, guest: null, ended: false, restored: false };
const tag = randomBytes(4).toString("hex");

async function uploadFile(tech, guest, name, body) {
  const xid = `k9${tag}${randomBytes(4).toString("hex")}`;
  out(`N ${name}`);
  const t0 = performance.now();
  tech.send({ t: "fsrv.init", xid, name, size: body.length, sha256: createHash("sha256").update(body).digest("hex"), purpose: "FILE" });
  const up = await tech.waitFor((m) => (m.t === "fsrv.upload" || m.t === "fsrv.status") && m.xid === xid, "fsrv.upload");
  if (up.t !== "fsrv.upload") throw new Stage("fsrv.init", 0, `${up.state}/${up.reason ?? "-"}`);
  out(`F ${up.fid}`);
  out(`N ${up.token.slice(0, 12)}`);
  let tLast = 0;
  for (let n = 0; n < up.chunks; n++) {
    const part = body.subarray(n * up.chunkBytes, (n + 1) * up.chunkBytes);
    await api(`PUT parça ${n}`, "PUT", `/api/v1/fsrv/uploads/${up.fid}/chunks/${n}`, {
      body: part,
      auth: false,
      headers: { authorization: `Bearer ${up.token}`, "content-type": "application/octet-stream" },
    });
    tLast = performance.now();
  }
  const final = await tech.waitFor(
    (m) => m.t === "fsrv.status" && m.fid === up.fid && ["CLEAN", "INFECTED", "SCAN_FAILED", "CORRUPT", "CANCELLED"].includes(m.state),
    "tarama sonucu",
    120_000,
  );
  return { fid: up.fid, chunks: up.chunks, final, t0, tLast };
}

async function smoke() {
  await loginFull();
  R("giriş: SUPER_ADMIN + TOTP doğrulandı");

  // (a) ClamAV "Bağlantıyı Test Et"
  const before = await api("clamav.get", "GET", "/api/v1/admin/settings/clamav");
  const t = await api("clamav.test", "POST", "/api/v1/admin/settings/clamav/test", { json: {} });
  const after = await api("clamav.get", "GET", "/api/v1/admin/settings/clamav");
  R(
    `(a) ClamAV testi: ok=${t.ok} PONG=${t.ok ? "evet" : "?"} EICAR=${t.eicarDetected} şifreli-zip=${t.encryptedDetected} ` +
      `sürüm="${t.version ?? "-"}" imza-yaşı=${t.signatureAgeDays ?? "-"} gün stale=${t.stale} kaynak=${before.source}→${after.source}`,
  );
  if (!t.ok) throw new Stage("clamav.test", 200, "NOT_OK");
  if (!process.env.K9_TECH_EMAIL) throw new Stage("(b)–(g) teknisyen hesabı", 0, "K9_TECH_* yok: k9-staging-account.sh --tech");

  // (b) demo firması: sunucu dosya modu (aydınlatma onayıyla)
  const tenants = await api(
    "tenants",
    "GET",
    `/api/v1/admin/tenants?q=${encodeURIComponent(env("K9_TENANT_SLUG"))}&status=active&page=1&pageSize=10`,
  );
  const tenant = (tenants.items ?? tenants.rows ?? tenants.data ?? []).find((x) => x.slug === env("K9_TENANT_SLUG"));
  if (!tenant) throw new Stage("tenant", 404, "NOT_FOUND");
  await api("switch-tenant", "POST", "/api/v1/admin/switch-tenant", { json: { tenantId: tenant.id } });
  const cur = await api("settings.get", "GET", "/api/v1/settings/tenant");
  state.prior = cur.fileServerMode === true;
  out(`M ${state.prior}`);
  if ((cur.maxFileMb ?? 0) < 50) throw new Stage("settings", 200, `maxFileMb<50`);
  if (!state.prior) await api("settings.put", "PUT", "/api/v1/settings/tenant", { json: { fileServerMode: true, consentUpdated: true } });
  const on = await api("settings.get", "GET", "/api/v1/settings/tenant");
  R(
    `(b) sunucu dosya modu: önce=${state.prior} şimdi=${on.fileServerMode} (aydınlatma onayı consentUpdated=true) saklama=${on.fileRetentionDays} gün`,
  );

  // (c) destek oturumu + tarayıcı misafiri (BROWSER → fsrv yetenekli). Teknisyen = demo firmasındaki K9_TECH_ hesabı.
  await logout();
  await loginFull("K9_TECH_", "ADMIN");
  const created = await api("sessions.create", "POST", "/api/v1/sessions", { json: {} });
  state.sessionId = created.id;
  out(`I ${created.id}`);
  const linkToken = created.link.split("/").pop();
  out(`N ${linkToken.slice(0, 12)}`);
  const cookie = `__Host-rs_session=${jar.get("__Host-rs_session")}`;
  const tech = await wsConnect(`/ws/tech?sessionId=${created.id}`, ["rs.v1"], { cookie });
  state.tech = tech;
  await tech.waitFor("hello", "tech hello");
  const res = await api("public.resolve", "POST", "/api/v1/public/sessions/resolve", {
    json: { token: linkToken, clientKind: "BROWSER" },
    auth: false,
  });
  const j = await api("public.join", "POST", "/api/v1/public/sessions/join", {
    json: { joinNonce: res.joinNonce, customerName: "K9 Test Müşteri", consentAccepted: true, consentTextId: res.consentText.id },
    auth: false,
  });
  out(`N ${j.wsTicket.slice(0, 12)}`);
  const guest = await wsConnect("/ws/guest", ["rs.v1", `rs.ticket.${j.wsTicket}`], {});
  state.guest = guest;
  await guest.waitFor("lobby.wait", "lobby.wait");
  await tech.waitFor("peer.pending", "peer.pending");
  tech.send({ t: "guest.admit", admitCode: j.admitCode });
  const hello = await guest.waitFor("hello", "guest hello");
  const joined = await tech.waitFor("peer.joined", "peer.joined");
  const fsrvOk = joined.fileMode === "SERVER" && (joined.guestFeatures ?? []).includes("fsrv") && hello.fileMode === "SERVER";
  R(`(c) destek oturumu: açıldı, misafir kabul edildi; oda fileMode=${joined.fileMode} misafir-fsrv=${fsrvOk ? "evet" : "hayır"}`);
  if (!fsrvOk) throw new Stage("oda", 0, "NOT_SERVER");

  // (d) EICAR → INFECTED, teklif yok
  const eicar = await uploadFile(tech, guest, `k9-eicar-${tag}.txt`, Buffer.from(avEicar()));
  await sleep(1500);
  const offered = guest.msgs.some((m) => m.t === "fsrv.offer" && m.fid === eicar.fid);
  R(`(d) EICAR: durum=${eicar.final.state} imza=${eicar.final.signature ?? "-"} misafire-teklif=${offered ? "VAR (HATA)" : "yok"}`);

  // (e) 50 MB rastgele (1 MiB parça) → CLEAN; AC-357: yükleme bitişi → teklif ≤ 30 sn
  const big = randomBytes(50 * 1024 * 1024);
  const r50 = await uploadFile(tech, guest, `k9-rand50-${tag}.bin`, big);
  const offer = await guest.waitFor((m) => m.t === "fsrv.offer" && m.fid === r50.fid, "fsrv.offer", 120_000).catch(() => null);
  const up = (r50.tLast - r50.t0) / 1000;
  const toClean = (r50.final.__at - r50.tLast) / 1000;
  const toOffer = offer ? (offer.__at - r50.tLast) / 1000 : NaN;
  R(
    `(e) 50 MB: parça=${r50.chunks} durum=${r50.final.state} yükleme=${up.toFixed(1)} sn; son parça→CLEAN=${toClean.toFixed(2)} sn; ` +
      `son parça→teklif=${offer ? toOffer.toFixed(2) : "teklif yok"} sn → AC-357 (≤ 30 sn) ${offer && toOffer <= 30 ? "GEÇTİ" : "KALDI"}`,
  );
  // test dosyasını sil: misafir reddeder → dosya diskten hemen silinir
  if (offer) {
    guest.send({ t: "fsrv.reject", fid: r50.fid });
    await tech.waitFor((m) => m.t === "fsrv.status" && m.fid === r50.fid && m.state === "REJECTED", "REJECTED", 15_000).catch(() => null);
  } else tech.send({ t: "fsrv.cancel", fid: r50.fid });

  await endSession();
  // (g) kanıt: geçmişte saklanan dosya durumları (dosya adı basılmaz) — teknisyen kendi oturumunu görür
  const h = await api("history", "GET", `/api/v1/sessions/${state.sessionId}/history`);
  await logout();
  await loginFull();
  await api("switch-tenant", "POST", "/api/v1/admin/switch-tenant", { json: { tenantId: tenant.id } });
  if (state.prior === false) await api("settings.put(geri)", "PUT", "/api/v1/settings/tenant", { json: { fileServerMode: false } });
  state.restored = true;
  const sf = (h.storedFiles ?? []).map(
    (f) => `${f.id === eicar.fid ? "eicar" : "50mb"}=${f.state}${f.canDownload ? "(indirilebilir!)" : ""}`,
  );
  const s2 = await api("settings.get", "GET", "/api/v1/settings/tenant");
  R(
    `(g) temizlik: oturum durumu=${h.status ?? h.session?.status ?? "-"}; saklanan dosyalar: ${sf.join(", ") || "yok"}; fileServerMode=${s2.fileServerMode} (önce ${state.prior})`,
  );
  await api("switch-tenant", "POST", "/api/v1/admin/switch-tenant", { json: { tenantId: null } });
  await logout();
  out("OK");
}

async function endSession() {
  if (state.tech && !state.ended) {
    state.tech.send({ t: "session.end" });
    await state.tech.waitFor("session.ended", "session.ended", 15_000).catch(() => null);
    state.ended = true;
  }
  for (const c of [state.guest, state.tech]) c?.ws.close();
}
/** Hata yolunda: oturumu bitir; mod geri alma sarmalayıcının `restore` moduna kalır (Super Admin + yeni TOTP adımı). */
async function cleanup() {
  await endSession();
  await logout();
  jar.clear();
}

/** Yarıda kalan smoke sonrası: oturumu iptal/sonlandır, modu eski değere al. */
async function restore() {
  const sid = process.env.K9_RESTORE_SESSION;
  if (sid && process.env.K9_TECH_EMAIL) {
    await loginFull("K9_TECH_", "ADMIN");
    const a = await request("POST", `/api/v1/sessions/${sid}/terminate`, { json: {} });
    const b = a.status >= 300 ? await request("POST", `/api/v1/sessions/${sid}/cancel`, { json: {} }) : a;
    R(`geri alma: oturum kapatma HTTP ${a.status}/${b.status}`);
    await logout();
  }
  await loginFull();
  const tenants = await api(
    "tenants",
    "GET",
    `/api/v1/admin/tenants?q=${encodeURIComponent(env("K9_TENANT_SLUG"))}&status=active&page=1&pageSize=10`,
  );
  const tenant = (tenants.items ?? tenants.rows ?? tenants.data ?? []).find((x) => x.slug === env("K9_TENANT_SLUG"));
  if (!tenant) throw new Stage("tenant", 404, "NOT_FOUND");
  await api("switch-tenant", "POST", "/api/v1/admin/switch-tenant", { json: { tenantId: tenant.id } });
  if (process.env.K9_RESTORE_MODE === "false") {
    await api("settings.put(geri)", "PUT", "/api/v1/settings/tenant", { json: { fileServerMode: false } });
    R("geri alma: fileServerMode=false");
  }
  await api("switch-tenant", "POST", "/api/v1/admin/switch-tenant", { json: { tenantId: null } });
  await logout();
  out("OK");
}

const run = { enroll, smoke, restore }[MODE];
if (!run) {
  process.stderr.write("k9: bilinmeyen K9_MODE\n");
  process.exit(2);
}
run()
  .then(() => process.exit(0))
  .catch(async (e) => {
    const s = e instanceof Stage ? `${e.stage} başarısız (HTTP ${e.status} ${e.code})` : "beklenmeyen hata (ayrıntı gizli tutuldu)";
    process.stderr.write(`k9: ${s}\n`);
    if (MODE === "smoke") await cleanup().catch(() => undefined);
    process.exit(1);
  });
