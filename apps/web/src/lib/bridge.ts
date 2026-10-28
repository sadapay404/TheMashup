/**
 * Platform bridge detection — import-free so both `api.ts` and `mobile.ts`
 * can use it without creating module cycles.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() ?? cap?.getPlatform?.() === "android");
}
