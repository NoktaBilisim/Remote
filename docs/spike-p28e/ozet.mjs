// K0s sonuç JSON'unu özetler: node docs/spike-p28e/ozet.mjs sonuc-chromium.json
// Boşluk tanımı (iki ölçü): gap = ilkKareKodu(N+1) − sonKareKodu(N) − kare aralığı (33,3 ms @30 fps). Kod = karenin çizildiği an (ms).
import { readFileSync } from "node:fs";

const R = JSON.parse(readFileSync(process.argv[2], "utf8"));
R.main ??= {};
R.resize ??= {};
R.background ??= {};
if (R.unavailable) {
  console.log(R.browser, "ölçülemedi:", R.unavailable);
  process.exit(0);
}
const FI = 1000 / 30;
const st = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return a.length
    ? { n: a.length, med: +s[Math.floor(s.length / 2)].toFixed(1), max: +s[s.length - 1].toFixed(1), min: +s[0].toFixed(1) }
    : null;
};
const gaps = (run) => {
  if (!run || !run.analysis || run.analysis.evalErr) return { err: run && run.analysis && run.analysis.evalErr };
  const a = run.analysis,
    g = [],
    g2 = [],
    api = [];
  for (let i = 0; i + 1 < a.length; i++) {
    if (a[i].last && a[i + 1].first) g.push(a[i + 1].first.code - a[i].last.code - FI);
    if (a[i].first && a[i].ranges.length && a[i + 1].first) g2.push(a[i + 1].first.code - (a[i].first.code + a[i].ranges.at(-1)[1] * 1000));
    const s0 = run.segments[i],
      s1 = run.segments[i + 1];
    api.push(s1.startEvt - s0.stopCall);
  }
  return {
    frameGapMs: st(g),
    endToStartMs: st(g2), // bölüm N buffered sonu (son kare süresi dahil) → bölüm N+1 ilk kare
    readErr: a
      .flatMap((x) => [x.first, x.last])
      .filter((x) => x && x.err)
      .map((x) => x.err),
    raw: g.map((x) => Math.round(x)),
    stopCallToNextStartEvtMs: st(api),
    firstFrameAfterStartCallMs: st(a.map((x, i) => (x.first ? x.first.code - run.segments[i].startCall : NaN)).filter((x) => !isNaN(x))),
    bufStart: a.map((x) => x.ranges && x.ranges[0] && +x.ranges[0][0].toFixed(3)),
    appendErr: a.map((x) => x.appendErr).filter(Boolean),
  };
};
const rate = (run) => {
  if (!run || !run.segments) return null;
  const segs = run.segments;
  const bytes = segs.reduce((x, s) => x + s.bytes, 0);
  const sec = (segs[segs.length - 1].stopEvt - segs[0].startCall) / 1000;
  const mbps = (bytes * 8) / sec / 1e6;
  const chunks = segs.flatMap((s) => s.chunks.map((c) => c.size));
  const first = segs.map((s) => s.chunks[0] && s.chunks[0].size);
  const ivals = segs.flatMap((s) => s.chunks.slice(1).map((c, k) => c.t - s.chunks[k].t));
  return {
    sec: +sec.toFixed(1),
    MB: +(bytes / 1e6).toFixed(2),
    mbps: +mbps.toFixed(3),
    GBperHour: +((mbps * 3600) / 8 / 1000).toFixed(3),
    GiBperHour: +(((bytes / sec) * 3600) / 2 ** 30).toFixed(3),
    chunkMaxKiB: Math.round(Math.max(...chunks) / 1024),
    chunkMedKiB: st(chunks.map((c) => c / 1024)).med,
    firstChunkKiB: first.map((c) => Math.round(c / 1024)),
    over2MiB: chunks.filter((c) => c > 2 * 2 ** 20).length,
    dataIntervalMs: st(ivals),
    timerDriftMs: segs.map((s) => Math.round(s.timerDrift)),
    errors: segs.flatMap((s) => s.errors),
  };
};
const out = {
  browser: R.browser,
  version: R.version,
  smoke: R.smoke,
  cpu: R.cpu,
  rate: { main1080scroll: rate(R.main), static1080: rate(R.static1080), scroll720: rate(R.scroll720) },
  gaps: { main: gaps(R.main), shortSync: gaps(R.shortSync), shortOnstop: gaps(R.shortOnstop), scroll720: gaps(R.scroll720) },
  mse: R.main.timeline && {
    offsets: R.main.timeline.offsets,
    abortNeeded: R.main.timeline.abortNeeded,
    setErr: R.main.timeline.setErr,
    ranges: R.main.timeline.ranges,
    seeks: R.main.timeline.seeks,
    plays: R.main.timeline.plays,
    evalErr: R.main.timeline.evalErr,
  },
  targetOnly: R.main.targetOnly,
  resize: {
    log: R.resize.log,
    errors: R.resize.segments && R.resize.segments[0].errors,
    chunks:
      R.resize.segments &&
      R.resize.segments[0].chunks.map((c) => [Math.round(c.t - R.resize.recStart), Math.round(c.size / 1024), c.state]),
    probe: R.resize.probe,
  },
  background: {
    hiddenWindow: R.background.hiddenWindow,
    rate: rate(R.background),
    gaps: gaps(R.background),
    drawPerSec: (R.background.drawLog || []).map((r, i, a) => (i ? [r[2], r[1] - a[i - 1][1]] : null)).filter(Boolean),
  },
  consoleErr: R.consoleErr,
};
console.log(JSON.stringify(out, null, 1));
