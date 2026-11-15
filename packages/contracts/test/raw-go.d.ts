// Vitest/Vite `?raw` içe aktarması: Go kaynak dosyası düz metin (yalnız testlerde; çalışma zamanı kodu kullanmaz).
declare module "*.go?raw" {
  const source: string;
  export default source;
}
