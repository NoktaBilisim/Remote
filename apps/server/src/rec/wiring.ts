// P28e uygulama bağlantısı (mimari-p28e r2 §2; `decorateFsrv` eşi). `app.rec` = servis + izleme yöneticisi. `buildApp` (app.ts)
// `decorateFsrv`'nin hemen arkasında kök örnekte çağırır: `bindRec` oda portunu ve `rooms.rec`'i rotalardan önce kurar.
// Depo P28b `FileStore` örneğidir (aynı kök, aynı kota).
// İzleme süpürücüsü 60 sn'de bir düşen belirteçlerin `recording.view.end` satırını yazar.
import type { FastifyInstance } from "fastify";
import type { FileStore } from "../fsrv/store.ts";
import type { SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import type { Metrics } from "../ops/metrics.ts";
import { bindRec } from "../signaling/rec.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Clock } from "../signaling/types.ts";
import { RecServiceImpl } from "./service.ts";
import { RecViews, VIEW_SWEEP_MS } from "./view.ts";

export interface RecRuntime {
  service: RecServiceImpl;
  views: RecViews;
}

declare module "fastify" {
  interface FastifyInstance {
    /** P28e oturum kaydı. */
    rec: RecRuntime;
  }
}

export function decorateRec(
  app: FastifyInstance,
  w: { db: Db; store: FileStore; secrets: SecretBox; metrics: Metrics; clock: Clock; rooms: Rooms; sweepOnReady: boolean },
): RecRuntime {
  const service = new RecServiceImpl({ db: w.db, store: w.store, secrets: w.secrets, metrics: w.metrics, clock: w.clock, log: app.log });
  const rt: RecRuntime = { service, views: new RecViews(service) };
  app.decorate("rec", rt);
  bindRec(w.rooms, service); // K4 oda portu + `rs_rec_active`
  // §3.4 açılış süpürmesi (yalnız `startJobs`): odası olmayan ACTIVE → STOPPED{ERROR, orphan}.
  if (w.sweepOnReady)
    app.addHook("onReady", async () => {
      const live = new Set<string>();
      for (const r of w.rooms.values()) live.add(r.sessionId);
      const n = await service.sweepOrphans(live).catch((err: unknown) => {
        app.log.error({ err }, "kayıt açılış süpürmesi başarısız");
        return 0;
      });
      if (n > 0) app.log.warn({ event: "rec_orphans_stopped", count: n }, "odasız etkin kayıtlar durduruldu");
    });
  const timer = setInterval(() => {
    void rt.views.sweep().catch((err: unknown) => app.log.error({ err }, "kayıt izleme süpürücüsü hatası"));
  }, VIEW_SWEEP_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  return rt;
}
