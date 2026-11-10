import { describe, expect, it } from "vitest";
import { MASK, maskValue } from "../../src/audit/mask.ts";

describe("audit maskesi", () => {
  it("AC-75: gizli anahtar adları *** (şifre, token, ticket, TURN credential, kurtarma kodu, çerez, Authorization, SDP/ICE, kabul kodu)", () => {
    const out = maskValue({
      password: "p",
      newPassword: "p",
      sessionToken: "t",
      wsTicket: "w",
      turnCredential: "c",
      recoveryCodes: ["a", "b"],
      cookie: "rs_session=x",
      Authorization: "Bearer x",
      sdp: "v=0",
      candidate: "candidate:1",
      admitCode: "1234",
      apiKey: "k",
      smtp: { secret: "s", host: "mail.example.test" },
    });
    expect(out).toEqual({
      password: MASK,
      newPassword: MASK,
      sessionToken: MASK,
      wsTicket: MASK,
      turnCredential: MASK,
      recoveryCodes: MASK,
      cookie: MASK,
      Authorization: MASK,
      sdp: MASK,
      candidate: MASK,
      admitCode: MASK,
      apiKey: MASK,
      smtp: { secret: MASK, host: "mail.example.test" },
    });
  });

  it("AC-75: izinli liste önce uygulanır — perm_key/permKey açık kalır, diziler içinde de", () => {
    const out = maskValue({ changes: [{ perm_key: "audit.view", old: false, new: true }], permKey: "sessions.create", reason: "x" });
    expect(out).toEqual({ changes: [{ perm_key: "audit.view", old: false, new: true }], permKey: "sessions.create", reason: "x" });
  });

  it("AC-75: izinli anahtarın değeri nesne/dizi ise içi yine taranır (S1-7)", () => {
    const out = maskValue({ source: { password: "p", via: "ui" }, reason: [{ token: "t" }], result: "ok" });
    expect(out).toEqual({ source: { password: MASK, via: "ui" }, reason: [{ token: MASK }], result: "ok" });
  });
});
