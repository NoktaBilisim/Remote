// Testlerin kullandığı `node:fs` alt kümesi (paket `types: []`). P29: ortak manifest fikstürlerini HAM bayt olarak okumak için
// (BOM/ASCII dışı vakalar metin okumada bozulur).
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
}
