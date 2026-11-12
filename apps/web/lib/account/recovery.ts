/** Kurtarma kodları indirme dosyası içeriği (düz metin, CRLF — Windows Not Defteri). Kodlar yalnız istemcide. */
export function recoveryFileText(codes: readonly string[], header: { title: string; account: string; note: string; createdAt: string }): string {
  return [header.title, header.account, header.createdAt, "", ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`), "", header.note, ""].join("\r\n");
}

/** Dosya adı: tarihli, kişisel veri yok. */
export const recoveryFileName = (day: string): string => `kurtarma-kodlari-${day}.txt`;
