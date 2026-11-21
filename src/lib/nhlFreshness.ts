interface Freshness { updatedAt: number; message?: string; }
const metadata = new WeakMap<object, Freshness>();
export function nhlFreshness(value: unknown) {
  return value !== null && typeof value === 'object' ? metadata.get(value) : undefined;
}
export function markNhlSaved<T>(value: T, updatedAt: number,
  message = 'NHL updates temporarily unavailable. Showing saved statistics.'): T {
  if (value !== null && typeof value === 'object') metadata.set(value, { updatedAt, message });
  return value;
}
export function markNhlFetched<T>(value: T, updatedAt: number): T {
  if (value !== null && typeof value === 'object') metadata.set(value, { updatedAt });
  return value;
}
export function inheritNhlFreshness<T>(value: T, sources: unknown[]): T {
  const sourcesWithAge = sources.map(nhlFreshness).filter((item): item is Freshness => Boolean(item));
  if (sourcesWithAge.length) {
    const oldest = sourcesWithAge.reduce((a, b) => a.updatedAt < b.updatedAt ? a : b);
    if (value !== null && typeof value === 'object') metadata.set(value, { updatedAt: oldest.updatedAt,
      message: sourcesWithAge.find(source => source.message)?.message });
  }
  return value;
}
