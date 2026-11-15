// PT-K1 sözleşme korkuluğu (mimari-temizlik §5 K1; AC-318): temizlik sırasında HTTP uç listesi değişirse bu test kırılır.
// Rota tablosu onRoute ile ready sırasında toplanır (rotalar eklentilerde yüklenir; bkz. helpers/tenant-matrix collectRoutes).
import { describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app.ts";

describe("PT-K1 HTTP yüzeyi", () => {
  it("AC-318: Fastify rota tablosu (metot + yol + schema varlığı) anlık görüntüyle aynı", async () => {
    const app = makeApp();
    const routes: string[] = [];
    app.addHook("onRoute", (r) => {
      for (const m of [r.method].flat()) routes.push(`${m} ${r.url}${r.schema ? " [schema]" : ""}`);
    });
    await app.ready();
    await app.close();
    expect(routes.sort()).toMatchSnapshot();
  });
});
