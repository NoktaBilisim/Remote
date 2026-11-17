// P28b K3 sinyal birim testleri (mimari-p28b §5.1, §5.4; D-P28b-5): `hasFsrv` / `capsFor` / `hello.fileMode` / misafir şeması
// tabloları ortak fikstürden (`packages/contracts/fixtures/fsrv.json`, Go eşi aynı dosyayı okur).
import { readFileSync } from "node:fs";
import type { Cap, GuestKind } from "@remote/contracts/ws";
import { guestInboundSchemaFor } from "@remote/contracts/ws";
import type { FileMode } from "@remote/contracts/ws-fsrv";
import { describe, expect, it } from "vitest";
import { newClipPrint } from "../../src/signaling/clip-print.ts";
import { capsFor, featureList, featuresOf, fsrvOf, hasFsrv } from "../../src/signaling/rooms-features.ts";
import type { Guest, Peer, Room } from "../../src/signaling/types.ts";
import { newMulti } from "../../src/signaling/members.ts";
import { newVoice } from "../../src/signaling/voice.ts";

interface FeatureRow {
  case: string;
  guestKind: GuestKind;
  unattended: boolean;
  subprotocols: string[];
  features: string[];
  hasFsrv: boolean;
}
interface CapsRow {
  case: string;
  fileMode: FileMode;
  roomCaps: Cap[];
  features: string[];
  guestCaps: Cap[];
  helloFileMode: boolean;
  fsrvSchema: boolean;
}
const fx = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/fsrv.json", import.meta.url), "utf8")) as {
  features: FeatureRow[];
  caps: CapsRow[];
};

function room(unattended: boolean, fileMode: FileMode = "P2P"): Room {
  return {
    sessionId: "S",
    tenantId: "T",
    technicianId: "U",
    technicianName: "Tek",
    multi: newMulti("U"),
    voice: newVoice(),
    expiresAt: 0,
    lobby: new Map(),
    lobbyArrivals: 0,
    admitting: false,
    admitFails: 0,
    rejectedIps: new Set(),
    caps: [],
    fileMeta: { quotas: new Map(), auditAt: new Map() },
    control: { state: "VIEW", granting: false, epoch: 0, requests: 0, monitorRequests: 0, chain: Promise.resolve() },
    clipPrint: newClipPrint(),
    timers: {},
    ending: false,
    fileMode,
    ...(unattended ? { unattended: { deviceId: "D", deviceName: "PC", customerId: "C", consentRequest: "ask" as const } } : {}),
  };
}

const guestOf = (kind: GuestKind) => ({ kind }) as Guest;
const fakePeer = (): Peer => ({ send: () => undefined, close: () => undefined, isOpen: () => true });

/** ws-auth `bindGuest` ile aynı adımlar: özellikler + fsrv bayrağı soket başına. */
function bind(r: Room, row: { guestKind: GuestKind; subprotocols: string[] }): Peer {
  const g = guestOf(row.guestKind);
  const p = fakePeer();
  p.features = featuresOf(row.subprotocols, r, g);
  if (fsrvOf(row.subprotocols, r, g)) p.fsrv = true;
  return p;
}

describe("P28b §5.1 hasFsrv tablosu (fikstür)", () => {
  for (const row of fx.features) {
    it(`AC-355 ${row.case}: features + hasFsrv`, () => {
      const r = room(row.unattended);
      const p = bind(r, row);
      expect(hasFsrv(r, p)).toBe(row.hasFsrv);
      expect(featureList(p.features ?? new Set(), hasFsrv(r, p))).toEqual(row.features);
    });
  }

  it("AC-355 gözetimsiz odada sonradan atanmış bayrak da okunmaz (ilk koşul !room.unattended)", () => {
    const p = fakePeer();
    p.fsrv = true;
    expect(hasFsrv(room(true), p)).toBe(false);
    expect(hasFsrv(room(false), undefined)).toBe(false);
  });
});

describe("P28b §5.4 caps / hello.fileMode / misafir şeması tablosu (fikstür)", () => {
  for (const row of fx.caps) {
    it(`AC-355 ${row.case} [${row.fileMode}]`, () => {
      const feat = fx.features.find((f) => f.case === row.case);
      if (!feat) throw new Error(`fikstürde özellik satırı yok: ${row.case}`);
      const r = room(feat.unattended, row.fileMode);
      const p = bind(r, feat);
      expect(capsFor(row.roomCaps, p.features ?? new Set(), row.fileMode)).toEqual(row.guestCaps);
      expect(hasFsrv(r, p)).toBe(row.helloFileMode);
      const schemaHasFsrv = r.fileMode === "SERVER" && hasFsrv(r, p);
      expect(schemaHasFsrv).toBe(row.fsrvSchema);
      const init = {
        t: "fsrv.init",
        xid: "xid-00000001",
        name: "a.txt",
        size: 10,
        sha256: "a".repeat(64),
        purpose: "FILE",
      };
      expect(guestInboundSchemaFor(p.features ?? new Set(), schemaHasFsrv).safeParse(init).success).toBe(row.fsrvSchema);
    });
  }

  it("AC-355 P2P varsayılanı: fileMode verilmezse caps eski davranışla birebir (regresyon)", () => {
    expect(capsFor(["remote_control", "file_transfer", "print"], new Set(["print"]))).toEqual(["remote_control", "file_transfer", "print"]);
  });
});
