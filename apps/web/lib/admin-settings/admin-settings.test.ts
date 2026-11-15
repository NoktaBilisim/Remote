import { describe, expect, it } from "vitest";
import {
  buildMysqlInput,
  buildTurnInput,
  mysqlDirty,
  mysqlServerFields,
  needsTurnSecret,
  toMysqlState,
  toTurnState,
  turnDirty,
} from "./forms";

const view = {
  host: "db.local",
  port: 3306,
  database: "remote",
  user: "app",
  hasPassword: true,
  updatedAt: null,
  source: "panel" as const,
  matchesRunning: true,
};

describe("MySQL formu (AC-77, 78)", () => {
  it("kayıtlı şifre forma yazılmaz; boş şifre gönderilmez (korunur)", () => {
    const st = toMysqlState(view);
    expect(st.password).toBe("");
    expect(buildMysqlInput(st).input).toEqual({ host: "db.local", port: 3306, database: "remote", user: "app" });
    expect(buildMysqlInput({ ...st, password: "yeni" }).input?.password).toBe("yeni");
  });
  it("port boşsa 3306; geçersiz port ve eksik alanlar alan hatası", () => {
    expect(buildMysqlInput({ ...toMysqlState(null), host: "h", database: "d", user: "u", port: "" }).input?.port).toBe(3306);
    const r = buildMysqlInput({ host: "", port: "70000", database: "a b", user: "", password: "" });
    expect(r.input).toBeUndefined();
    expect(Object.keys(r.errors).sort()).toEqual(["database", "host", "port", "user"]);
  });
  it("kirli: şifre yazılması veya alan değişimi", () => {
    const st = toMysqlState(view);
    expect(mysqlDirty(st, st)).toBe(false);
    expect(mysqlDirty({ ...st, password: "x" }, st)).toBe(true);
    expect(mysqlServerFields({ host: "Geçersiz", x: "Diğer" })).toEqual({ errors: { host: "Geçersiz" }, rest: ["Diğer"] });
  });
});

describe("TURN formu (AC-78)", () => {
  it("boş satırlar atılır; satır hatası ekrandaki sıraya bağlanır", () => {
    const r = buildTurnInput({ urls: ["turn:a.example.com:3478", "", "http://x"], secret: "" });
    expect(r.input).toBeUndefined();
    expect(r.errors.url?.[2]).toMatch(/stun:, turn: veya turns:/);
    expect(buildTurnInput({ urls: ["turns:a.example.com:443", " "], secret: "" }).input).toEqual({ urls: ["turns:a.example.com:443"] });
  });
  it("en az bir adres; secret'ta boşluk ve # yasak (coturn yapılandırma satırı)", () => {
    expect(buildTurnInput({ urls: [""], secret: "" }).errors.urls).toBeTruthy();
    expect(buildTurnInput({ urls: ["turn:a.example.com"], secret: `${"a".repeat(31)}#` }).errors.secret).toBeTruthy();
    expect(buildTurnInput({ urls: ["turn:a.example.com"], secret: "a".repeat(32) }).input?.secret).toBe("a".repeat(32));
  });
  it("secret kısa → hata; kayıtlı secret forma yazılmaz", () => {
    expect(buildTurnInput({ urls: [], secret: "kisa" }).errors.secret).toBeTruthy();
    const st = toTurnState({ urls: ["turn:a.example.com"], hasSecret: true, source: "panel", updatedAt: null });
    expect(st.secret).toBe("");
    expect(turnDirty(st, st)).toBe(false);
    expect(turnDirty({ ...st, urls: [...st.urls, ""] }, st)).toBe(true);
    expect(needsTurnSecret(["stun:x.example.com"])).toBe(false);
    expect(needsTurnSecret(["turns:x.example.com"])).toBe(true);
  });
});
