import { describe, expect, it } from "vitest";
import { consoleSessionId, lobbyToast, toPrev, type LobbySession } from "./diff";

// AC-307 (mimari-lobi §6.3): toast yalnız yeni gelen ve hâlâ bekleyen misafir için; temel çizgide yok.
const A = "01JSES0000000000000000000A";
const B = "01JSES0000000000000000000B";
const s = (id: string, waiting: number, arrivals: number): LobbySession => ({ id, waiting, arrivals });

describe("lobi toast farkı (AC-307)", () => {
  it("temel çizgi (prev null): sayfa yüklenirken bekleyenler için toast yok", () => {
    expect(lobbyToast(null, [s(A, 2, 2)], null)).toBeNull();
  });
  it("tek oturuma tek geliş → n=1, hedef o oturumun konsolu", () => {
    expect(lobbyToast(toPrev([]), [s(A, 1, 1)], null)).toEqual({ n: 1, target: { kind: "console", id: A } });
  });
  it("iki oturuma geliş → n=2, hedef oturum listesi", () => {
    expect(lobbyToast(toPrev([]), [s(A, 1, 1), s(B, 1, 1)], null)).toEqual({ n: 2, target: { kind: "list" } });
  });
  it("aynı oturuma aynı anda iki misafir → n=2, tek oturum → konsol", () => {
    expect(lobbyToast(toPrev([]), [s(A, 2, 2)], null)).toEqual({ n: 2, target: { kind: "console", id: A } });
  });
  it("aynı misafir (arrivals sabit) sonraki yoklamada → toast yok", () => {
    expect(lobbyToast(toPrev([s(A, 1, 1)]), [s(A, 1, 1)], null)).toBeNull();
  });
  it("biri çıkıp başkası girdi (waiting sabit, arrivals +1) → n=1", () => {
    expect(lobbyToast(toPrev([s(A, 1, 1)]), [s(A, 1, 2)], null)?.n).toBe(1);
  });
  it("gelip giden misafir (yanıtta oturum yok / waiting azaldı) → toast yok", () => {
    expect(lobbyToast(toPrev([s(A, 1, 1)]), [], null)).toBeNull();
    // arrivals 1→3 ama yalnız 1 bekliyor: 2 yeni gelişten en çok 1'i hâlâ orada
    expect(lobbyToast(toPrev([s(A, 1, 1)]), [s(A, 1, 3)], null)?.n).toBe(1);
  });
  it("arrivals küçüldü (sunucu yeniden başladı / oda yeniden yaratıldı) → yeni sayılır", () => {
    expect(lobbyToast(toPrev([s(A, 2, 5)]), [s(A, 1, 1)], null)).toEqual({ n: 1, target: { kind: "console", id: A } });
  });
  it("açık konsoldaki oturum sayılmaz; başka oturumdaki geliş sayılır ve hedef liste olur", () => {
    expect(lobbyToast(toPrev([]), [s(A, 1, 1)], A)).toBeNull();
    expect(lobbyToast(toPrev([s(A, 1, 1)]), [s(A, 1, 1), s(B, 1, 1)], A)).toEqual({ n: 1, target: { kind: "list" } });
  });
  it("konsol yolu ayrıştırma", () => {
    expect(consoleSessionId(`/sessions/${A}/console`)).toBe(A);
    expect(consoleSessionId("/sessions")).toBeNull();
    expect(consoleSessionId(`/sessions/${A}`)).toBeNull();
  });
});
