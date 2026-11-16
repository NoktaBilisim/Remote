// P28b-K2 sözleşmeleri (mimari-p28b §4, §5, §7.3, §11 r2; AC-353..363, 404). Ortak fikstür `fixtures/fsrv.json` (Go K5 aynı dosya).
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/fsrv.json" with { type: "json" };
import { AUDIT_ACTION_GROUPS } from "../src/api/audit.ts";
import * as av from "../src/api/clamav.ts";
import * as api from "../src/api/fsrv.ts";
import { TIMELINE_ACTIONS } from "../src/api/sessions.ts";
import { updateTenantInputSchema, updateTenantSettingsInputSchema } from "../src/api/tenants.ts";
import { FSRV_AUDIT, FSRV_AUDIT_LABELS } from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import {
  AV_SCAN_REASON_LABELS,
  describeFsrvStatus,
  describeTimelineEvent,
  FSRV_GATE_REASON_LABELS,
  STORED_FILE_STATE_LABELS,
} from "../src/labels.ts";
import { PERMISSION_KEYS } from "../src/permissions.ts";
import { GUEST_FEATURE_BY_SUBPROTOCOL } from "../src/ws-clip-print.ts";
import * as f from "../src/ws-fsrv.ts";
import { CAPS, guestInboundSchema, guestInboundSchemaFor, serverOutboundSchema, techInboundSchema } from "../src/ws.ts";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean => schema.safeParse(v).success;
const NONE = new Set<never>();
const CLIP_PRINT = new Set(["clipboard", "print"] as const);

/** Test içi base64 çözücü (paket lib'inde `atob`/`Buffer` tipi yok). */
function unb64(s: string): number[] {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s.replace(/=+$/, "")) {
    buf = (buf << 6) | A.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

describe("P28b WS sözleşmesi (fikstür, Go ile ortak)", () => {
  it("AC-355 valid.inbound teknisyen şemasından ve fsrv'li misafir şemasından geçer; invalid.inbound reddedilir", () => {
    const guest = guestInboundSchemaFor(CLIP_PRINT, true);
    for (const m of fixture.valid.inbound) {
      expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(true);
      expect(ok(guest, m), JSON.stringify(m)).toBe(true);
    }
    for (const m of fixture.invalid.inbound) {
      expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(false);
      expect(ok(guest, m), JSON.stringify(m)).toBe(false);
    }
  });

  it("AC-355 misafir şemasında fsrv.* yalnız fsrv=true iken (SERVER + hasFsrv); aksi 1008; P28a özellikleri korunur", () => {
    const m = fixture.valid.inbound[0];
    expect(ok(guestInboundSchema, m)).toBe(false);
    for (const feats of [NONE, CLIP_PRINT, new Set(["clipboard"] as const), new Set(["print"] as const)]) {
      expect(ok(guestInboundSchemaFor(feats), m)).toBe(false);
      expect(ok(guestInboundSchemaFor(feats, true), m)).toBe(true);
      expect(ok(guestInboundSchemaFor(feats, true), { t: "session.end" })).toBe(true);
    }
    expect(ok(guestInboundSchemaFor(NONE, true), { t: "clip.consent", on: true })).toBe(false);
    expect(ok(guestInboundSchemaFor(new Set(["clipboard"] as const), true), { t: "clip.consent", on: true })).toBe(true);
    // Aynı anahtar aynı şema örneği (önbellek).
    expect(guestInboundSchemaFor(CLIP_PRINT, true)).toBe(guestInboundSchemaFor(new Set(["print", "clipboard"] as const), true));
  });

  it("AC-358/359 sunucu çıkışı: upload/status/offer/download + hello/peer.joined fileMode; (state, reason) kuralları", () => {
    for (const m of fixture.valid.server) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fixture.invalid.server) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(false);
    expect(CAPS).toEqual(["remote_control", "file_transfer", "clipboard", "print"]);
  });

  it("AC-355 PRINT kuralı: pid zorunlu + ad belge.pdf; boyut/pid eşleşmesi şemada değil (kapı FORBIDDEN)", () => {
    const base = { t: "fsrv.init", xid: "aZ3_x-Q9LmN0pR7sT2uV1w", sha256: "a".repeat(64), purpose: "PRINT", pid: "Pq8-Zx_4KdLm2Nb7Vc1Ty0" };
    expect(ok(f.fsrvInitSchema, { ...base, name: "belge.pdf", size: f.FSRV_PRINT_MAX_BYTES + 1 })).toBe(true);
    expect(ok(f.fsrvInitSchema, { ...base, name: "gizli-ad.pdf", size: 10 })).toBe(false);
  });

  it("AC-355/362 sabitler fikstürle (Go) aynı; kümeler ve alt protokol", () => {
    const c = fixture.constants;
    const got: Record<string, unknown> = {};
    for (const k of Object.keys(c)) {
      const v = (f as Record<string, unknown>)[k];
      got[k] = v instanceof RegExp ? v.source : v;
    }
    expect(got).toEqual(c);
    expect(f.FSRV_MAX_CHUNKS * f.FSRV_CHUNK_BYTES).toBe(f.FSRV_MAX_BYTES);
    expect(f.FSRV_CHUNK_BYTES % f.FSRV_SEGMENT_BYTES).toBe(0);
    expect(fixture.subprotocol).toBe(f.WS_GUEST_CAP_FSRV);
    // P28a eşleme tablosuna girmez (fsrv `Cap` değildir); sunucu `hasFsrv` ayrı okur.
    expect(GUEST_FEATURE_BY_SUBPROTOCOL[f.WS_GUEST_CAP_FSRV]).toBeUndefined();
    expect(fixture.sets).toEqual({
      fileModes: [...f.FILE_MODES],
      purposes: [...f.FSRV_PURPOSES],
      peerFeatures: [...f.PEER_FEATURES],
      storedStates: [...f.STORED_FILE_STATES],
      wireStates: [...f.FSRV_WIRE_STATES],
      gateReasons: [...f.FSRV_GATE_REASONS],
      scanReasons: [...f.AV_SCAN_REASONS],
    });
    expect(new Set(f.FSRV_STATUS_REASONS)).toEqual(new Set([...f.FSRV_GATE_REASONS, ...f.AV_SCAN_REASONS]));
  });

  it("AC-355 §5.1/§5.4 tablo: SERVER odasında misafir caps'inden file_transfer/print düşer; fsrv şeması yalnız SERVER + hasFsrv", () => {
    for (const row of fixture.features) {
      expect(row.hasFsrv, row.case).toBe(row.features.includes("fsrv"));
      if (row.unattended) expect(row.features).toEqual([]);
    }
    for (const row of fixture.caps) {
      for (const cap of row.guestCaps) expect(CAPS as readonly string[]).toContain(cap);
      const expected = row.roomCaps
        .filter((c) => (c === "clipboard" || c === "print" ? row.features.includes(c) : true))
        .filter((c) => row.fileMode === "P2P" || (c !== "file_transfer" && c !== "print"));
      expect(row.guestCaps, `${row.case} ${row.fileMode}`).toEqual(expected);
      expect(row.fsrvSchema).toBe(row.fileMode === "SERVER" && row.helloFileMode);
    }
    const oldServer = fixture.caps.find((r) => r.features.length === 0 && r.fileMode === "SERVER");
    expect(oldServer?.guestCaps).toEqual(["remote_control"]);
  });

  it("AC-356 parça hesabı: son parça hariç tam 1 MiB", () => {
    expect(f.fsrvChunkCount(1)).toBe(1);
    expect(f.fsrvChunkCount(f.FSRV_CHUNK_BYTES)).toBe(1);
    expect(f.fsrvChunkCount(f.FSRV_CHUNK_BYTES + 1)).toBe(2);
    expect(f.fsrvChunkCount(f.FSRV_MAX_BYTES)).toBe(256);
    expect(f.fsrvChunkSize(f.FSRV_CHUNK_BYTES + 1, 0)).toBe(f.FSRV_CHUNK_BYTES);
    expect(f.fsrvChunkSize(f.FSRV_CHUNK_BYTES + 1, 1)).toBe(1);
    expect(f.fsrvChunkSize(f.FSRV_CHUNK_BYTES + 1, 2)).toBe(0);
    expect(f.fsrvChunkSize(10, -1)).toBe(0);
  });
});

describe("P28b REST sözleşmesi", () => {
  const FID = "01JD5ZQ8X3M4N5P6Q7R8S9T0VW";

  it("AC-356 parça yolu: n 0..255 ondalık, baştaki sıfır yok; fid ULID", () => {
    expect(api.fsrvChunkParamsSchema.parse({ fid: FID, n: "0" })).toEqual({ fid: FID, n: 0 });
    expect(api.fsrvChunkParamsSchema.parse({ fid: FID, n: "255" }).n).toBe(255);
    for (const n of ["256", "01", "-1", "1.5", "", "1e2"]) expect(ok(api.fsrvChunkParamsSchema, { fid: FID, n }), n).toBe(false);
    expect(ok(api.fsrvChunkParamsSchema, { fid: "../x", n: "0" })).toBe(false);
    expect(ok(api.storedFileLinkParamsSchema, { id: FID, fid: FID })).toBe(true);
  });

  it("AC-356 belirteç yalnız Bearer başlığında, 43 karakter base64url", () => {
    const tok = "Abc_defGhijKlmnOpqrStuvWxyz0123456789-_ABCD";
    expect(api.fsrvBearerSchema.parse(`Bearer ${tok}`)).toBe(tok);
    for (const h of [tok, `bearer ${tok}`, `Bearer ${tok}x`, `Bearer ${tok.slice(1)}`, `Bearer ${tok} `])
      expect(ok(api.fsrvBearerSchema, h), h).toBe(false);
    expect(api.FSRV_CONTENT_HEADERS["Content-Security-Policy"]).toBe("sandbox; default-src 'none'");
  });

  it("AC-353 ClamAV ayarı: host DB CHECK biçimi (köşeli IPv6 yok), port vars. 3310; test girdisi boş olabilir", () => {
    expect(av.clamavSettingsInputSchema.parse({ host: " ClamAV " })).toEqual({ host: "clamav", port: 3310 });
    expect(ok(av.clamavSettingsInputSchema, { host: "172.30.2.2", port: 3310 })).toBe(true);
    expect(ok(av.clamavSettingsInputSchema, { host: "fd00::2", port: 3310 })).toBe(true);
    for (const host of ["[fd00::2]", "-x", "", "a b", "x".repeat(254), "clamav/x"])
      expect(ok(av.clamavSettingsInputSchema, { host }), host).toBe(false);
    expect(ok(av.clamavSettingsInputSchema, { host: "clamav", port: 0 })).toBe(false);
    expect(ok(av.clamavSettingsInputSchema, { host: "clamav", port: 3310, extra: 1 })).toBe(false);
    expect(ok(av.clamavTestInputSchema, {})).toBe(true);
    expect(av.CLAMAV_TEST_MESSAGES.encrypted_off).toBe("Şifreli arşiv algılaması kapalı");
    expect(av.CLAMAV_HOST_NOT_ALLOWED_MESSAGE).toBe("Adres virüs tarama ağının dışında");
  });

  it("AC-353 öz-sınama: EICAR iki parçadan bellekte (68 bayt), şifreli zip ZipCrypto bayraklı ve zararsız", () => {
    const e = av.avEicar();
    expect(e).toHaveLength(68);
    expect(e.startsWith("X5O!P%@AP")).toBe(true);
    expect(e.endsWith("FILE!$H+H*")).toBe(true);
    const z = unb64(av.AV_SELFTEST_ENCRYPTED_ZIP_B64);
    expect(z.slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect((z[6] ?? 0) & 1).toBe(1); // genel amaç bayrağı bit 0 = şifreli
    expect(z.length).toBeLessThan(512);
    expect(av.AV_MAX_SCAN_TIME_SIGNATURE.startsWith(av.AV_LIMITS_PREFIX)).toBe(true);
  });

  it("AC-354 tenant Dosyalar ayarı: fileServerMode, saklama 1..7, consentUpdated yalnız true", () => {
    const s = updateTenantSettingsInputSchema;
    expect(ok(s, { fileServerMode: true, consentUpdated: true, fileRetentionDays: 7 })).toBe(true);
    expect(ok(s, { fileRetentionDays: 1 })).toBe(true);
    for (const d of [0, 8, 1.5]) expect(ok(s, { fileRetentionDays: d }), String(d)).toBe(false);
    expect(ok(s, { fileServerMode: true, consentUpdated: false })).toBe(false);
    expect(api.AV_NOT_READY_MESSAGE).toBe("Önce virüs tarama bağlantısını başarıyla test edin");
  });

  it("AC-362 Super Admin kota: 1..2000 GB; hata kodları STORAGE_QUOTA ve AV_NOT_READY 409", () => {
    expect(ok(updateTenantInputSchema, { storageQuotaGb: 20 })).toBe(true);
    for (const q of [0, 2001, 1.5]) expect(ok(updateTenantInputSchema, { storageQuotaGb: q }), String(q)).toBe(false);
    expect(ERROR_STATUS.STORAGE_QUOTA).toBe(409);
    expect(ERROR_STATUS.AV_NOT_READY).toBe(409);
    expect(api.STORAGE_QUOTA_MESSAGE).toBe("Firma depolama kotası doldu");
  });
});

describe("P28b audit, etiketler, yetki", () => {
  it("AC-404 yeni yetki anahtarı yok (session_history.view + file_transfer.use mevcut)", () => {
    expect(PERMISSION_KEYS).toContain("file_transfer.use");
    expect(PERMISSION_KEYS).toContain("session_history.view");
    expect(PERMISSION_KEYS.filter((k) => /fsrv|clamav|storage/.test(k))).toEqual([]);
  });

  it("AC-358/360 FSRV_AUDIT adları + Türkçe etiketler; oturum olayları zaman çizelgesinde; filtre grupları mevcut", () => {
    expect(Object.values(FSRV_AUDIT).sort()).toEqual([
      "file.download",
      "file.expired",
      "file.infected",
      "file.scan",
      "file.upload",
      "settings.clamav",
      "settings.clamav.test",
      "tenant.storage_quota",
    ]);
    for (const a of Object.values(FSRV_AUDIT)) expect(FSRV_AUDIT_LABELS[a]).toBeTruthy();
    for (const a of ["file.upload", "file.scan", "file.infected", "file.download"]) expect(TIMELINE_ACTIONS as string[]).toContain(a);
    expect(TIMELINE_ACTIONS as string[]).not.toContain("file.expired");
    expect(AUDIT_ACTION_GROUPS.map((g) => g.prefix)).toEqual(expect.arrayContaining(["file.*", "settings.*", "tenant.*"]));
  });

  it("AC-358/359 durum metinleri (state, reason) çiftinden; BUSY ve REJECTED iki anlamlı", () => {
    expect(describeFsrvStatus("INFECTED", null, "Eicar-Test-Signature")).toBe(
      "Dosya virüslü bulundu (Eicar-Test-Signature), teslim edilmedi",
    );
    expect(describeFsrvStatus("INFECTED")).toBe("Dosya virüslü bulundu (bilinmeyen imza), teslim edilmedi");
    expect(describeFsrvStatus("SCAN_FAILED", "ENCRYPTED")).toBe("Dosya taranamadı, teslim edilmedi: şifreli arşiv");
    expect(describeFsrvStatus("SCAN_FAILED", "UNAVAILABLE")).toBe("Dosya taranamadı, teslim edilmedi: tarama servisine ulaşılamadı");
    expect(describeFsrvStatus("SCAN_FAILED", "BUSY")).toBe("Virüs tarama servisi yoğun, dosya teslim edilmedi");
    expect(describeFsrvStatus("REJECTED", "BUSY")).toBe("Başka bir dosya aktarımı sürüyor");
    expect(describeFsrvStatus("REJECTED")).toBe("Alıcı reddetti");
    expect(describeFsrvStatus("REJECTED", "SESSION_LIMIT")).toBe("Bu oturumda sunucu üzerinden en çok 2 GB aktarılabilir");
    expect(describeFsrvStatus("REJECTED", "QUOTA")).toBe(api.STORAGE_QUOTA_MESSAGE);
    expect(describeFsrvStatus("SCANNING")).toBeNull();
    for (const r of f.AV_SCAN_REASONS) expect(AV_SCAN_REASON_LABELS[r]).toBeTruthy();
    for (const r of f.FSRV_GATE_REASONS) expect(FSRV_GATE_REASON_LABELS[r]).toBeTruthy();
    for (const s of [...f.STORED_FILE_STATES, ...f.FSRV_WIRE_STATES]) expect(STORED_FILE_STATE_LABELS[s]).toBeTruthy();
  });

  it("AC-358 zaman çizelgesi: virüs bulgusu uyarı + imza; ad yok", () => {
    const inf = describeTimelineEvent({
      action: "file.infected",
      details: { signature: "Eicar-Test-Signature", ext: "exe", sizeBytes: 68 },
    });
    expect(inf).toEqual({ label: "Virüslü dosya bulundu", note: "İmza: Eicar-Test-Signature", warn: true });
    expect(describeTimelineEvent({ action: "file.scan", details: { result: "SCAN_FAILED", reason: "TIMEOUT" } }).note).toBe(
      "Taranamadı: tarama zaman aşımı",
    );
    expect(describeTimelineEvent({ action: "file.download", details: { context: "history", by: "tech" } }).note).toBe("Oturum geçmişinden");
  });
});
