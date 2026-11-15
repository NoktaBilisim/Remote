// İstemci sürüm karşılaştırması (P8b r2, mimari-e9 §13.4, G-E9-4). Sürüm istemci beyanıdır: dürüst kullanıcıyı eski
// ikiliden korur, zararlı istemciye karşı değildir.

const parts = (v: string): [number, number, number] => {
  const [a = 0, b = 0, c = 0] = v.split(".").map((n) => Number(n) || 0);
  return [a, b, c];
};

/** -1 / 0 / 1 (semver çekirdeği x.y.z; ön sürüm etiketi yok). */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

/** `min` tanımlı ve `version` (yoksa 0.0.0) ondan düşükse true. */
export const isOutdated = (version: string | undefined, min: string | undefined): boolean =>
  min !== undefined && compareVersions(version ?? "0.0.0", min) < 0;
