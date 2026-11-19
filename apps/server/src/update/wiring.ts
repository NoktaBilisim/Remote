// P29 kurulum (mimari-p29 §2): manifest deposu mevcut ikili kapılarını (`app.agentBinary`, `macAgentBinary`, `linuxAgentBinary`,
// `unattendedBinary`) yeniden kullanır — ikinci kapı açılmaz. Açılışta imza doğrulaması + uyarı (AC-473), göstergeler, sürüm
// göstergesi 60 sn'de bir DB'den (yalnız `startJobs`; testler `refreshGauge`'i doğrudan çağırır).
import type { FastifyInstance } from "fastify";
import type { Env } from "../env.ts";
import { ManifestStore, type SlotGate } from "./manifest-store.ts";
import { UpdateService } from "./service.ts";
import { VersionsView } from "./versions.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** P29: güncelleme manifestleri, belirteçler, politika, hız kovaları. */
    updates: UpdateService;
    /** P29: sürüm dağılımı + `rs_unattended_agent_versions` önbelleği. */
    updateVersions: VersionsView;
  }
}

export interface UpdateWiringOptions {
  env: Env;
  now: () => number;
  startJobs: boolean;
}

export function decorateUpdates(app: FastifyInstance, o: UpdateWiringOptions): void {
  const { env } = o;
  const gate = (check: () => ReturnType<SlotGate["check"]>, expectedSha256: string | undefined): SlotGate => ({ check, expectedSha256 });
  const store = new ManifestStore({
    dir: env.UPDATE_MANIFEST_DIR,
    pubkeys: env.updateManifestPubkeys,
    deployEnv: env.DEPLOY_ENV,
    gates: {
      "client-windows": gate(() => app.agentBinary.check(), env.AGENT_SHA256),
      "client-macos": gate(() => app.macAgentBinary.check(), env.MAC_AGENT_SHA256),
      "client-linux": gate(() => app.linuxAgentBinary.check(), env.LINUX_AGENT_SHA256),
      "service-windows": gate(() => app.unattendedBinary.check(), env.UNATTENDED_AGENT_SHA256),
    },
    signedMode: { signed: env.UNATTENDED_MODE === "signed", list: env.unattendedSignedSha256 },
    now: o.now,
    warn: (obj, msg) => app.log.warn(obj, msg),
  });
  const updates = new UpdateService({ store, db: app.db, metrics: app.metrics, now: o.now });
  const versions = new VersionsView({ db: app.db, updates, minVersion: env.MIN_AGENT_VERSION });
  app.decorate("updates", updates);
  app.decorate("updateVersions", versions);
  app.metrics.labeledGauge(
    "rs_update_manifest_expiry_seconds",
    "Yüklü (imzası geçerli) güncelleme manifestinin kalan süresi, sn (P29; component, platform) — alarm < 14 g",
    () => store.expirySeconds(),
  );
  app.metrics.labeledGauge("rs_unattended_agent_versions", "Gözetimsiz servis sürüm dağılımı (P29; version ≤ 50 + other)", () =>
    versions.gaugeSeries(),
  );
  let timer: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    await store.warm();
    if (!o.startJobs) return;
    const refresh = () => versions.refreshGauge().catch((err: unknown) => app.log.error({ err }, "sürüm göstergesi okunamadı"));
    await refresh();
    timer = setInterval(() => void refresh(), 60_000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    updates.close();
  });
}
