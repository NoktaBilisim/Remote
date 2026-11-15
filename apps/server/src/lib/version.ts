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

/**
 * `min` tanımlı ve `version` ondan düşükse true. P19 (S-P19-13): `version` artık `undefined` kabul etmez — WEB talebinin
 * NULL sürümü derlemede yakalanır; çağıran sürüm kapısını yalnız AGENT dalında çağırır (`?? "0.0.0"` yasak).
 */
export const isOutdated = (version: string, min: string | undefined): boolean => min !== undefined && compareVersions(version, min) < 0;

/**
 * Oturum bağlantısı (resolve/join, P8b r2) yolunda sürüm beyan etmeyen 0.8.x AGENT'ın sayıldığı sürüm. Yalnız oturum
 * akışında açıkça kullanılır; talep `client_version` alanı için KULLANILMAZ (S-P19-13: WEB'in NULL'ı sürüm sayılmaz).
 */
export const UNDECLARED_AGENT_VERSION = "0.0.0";
