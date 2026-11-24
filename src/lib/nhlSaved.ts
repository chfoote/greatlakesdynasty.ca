import { markNhlFetched, markNhlSaved, nhlFreshness } from "./nhlFreshness.ts";
import { nhlStatsDate } from "../../shared/nhl-live.ts";
// Only assembled public NHL datasets belong here. Never store league rosters,
// Supabase records, authentication, or partially fetched report pages.
export interface SavedNhlData<T> { value: T; updatedAt: number; message?: string; scope?: string; baseline?: boolean; }
export interface NhlDataStatus { updatedAt?: number; refreshing: boolean; saved: boolean; message?: string; dataset?: string; }
const prefix = 'gld:complete-nhl:v1:';
const retention = 7 * 86400_000;
const statuses = new Map<string, NhlDataStatus>();
let statusSnapshot: NhlDataStatus[] = [];
const listeners = new Set<() => void>();
let activeKeys: Set<string> | undefined;
export const subscribeNhlStatus = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getNhlStatuses = () => statusSnapshot;
function publish() {
  statusSnapshot = [...statuses.entries()].filter(([key]) => !activeKeys || activeKeys.has(key)).map(([, value]) => value);
  listeners.forEach(listener => listener());
}
export function setNhlDataScope(keys: string[]) { activeKeys = new Set(keys); publish(); }
function status(key: string, value: NhlDataStatus) {
  statuses.set(key, { ...value, dataset: key });
  if (statuses.size > 64) statuses.delete(statuses.keys().next().value!);
  publish();
}
export class NhlBaselineAvailable extends Error {
  readonly value: unknown;
  constructor(value: unknown, message: string) { super(message); this.value = value; }
}
function changed() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('nhl-data-updated'));
}

export function createSavedNhlCache(options: {
  now?: () => number;
  storage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  onChange?: () => void;
} = {}) {
  const now = options.now ?? Date.now;
  const memory = new Map<string, SavedNhlData<unknown>>();
  const pending = new Map<string, Promise<unknown>>();
  const failedUntil = new Map<string, number>();
  const storage = options.storage ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } });
  function persist(key: string, entry: SavedNhlData<unknown>) {
    try {
      const store = storage();
      if (!store) return;
      const indexKey = prefix + 'index';
      const raw = JSON.parse(store.getItem(indexKey) || '[]');
      let index: Array<{ key: string; size: number }> = Array.isArray(raw)
        ? raw.filter(item => typeof item?.key === 'string' && item.key.startsWith(prefix) && Number.isFinite(item.size)) : [];
      index = index.filter(item => item.key !== key);
      const encoded = JSON.stringify(entry), size = encoded.length * 2;
      if (size > 3_000_000) return;
      while (index.length && (index.length >= 24 || index.reduce((sum, item) => sum + item.size, 0) + size > 3_000_000)) {
        store.removeItem(index.shift()!.key);
      }
      store.setItem(key, encoded);
      store.setItem(indexKey, JSON.stringify([...index, { key, size }]));
    } catch { /* A full/private browser cache must not break the page. */ }
  }
  return async function saved<T>(key: string, load: () => Promise<T>, validate: (value: unknown) => value is T,
    ttl = 300_000, policy: { waitForRefresh?: boolean; staleRetryMs?: number; scope?: string } = {}): Promise<T> {
    let previous = memory.get(key) as SavedNhlData<T> | undefined;
    if (!previous) {
      try { previous = JSON.parse(storage()?.getItem(prefix + key) || 'null') ?? undefined; } catch { /* Optional storage. */ }
    }
    if (previous && (!Number.isFinite(previous.updatedAt) || previous.updatedAt > now()
      || now() - previous.updatedAt > retention || !validate(previous.value))) previous = undefined;
    // Entries created before daily scopes existed can be migrated from their
    // actual source time. Do not discard today's live points during an upgrade.
    const previousScope = previous?.scope ?? (previous && policy.scope && /^\d{4}-\d{2}-\d{2}$/.test(policy.scope)
      ? nhlStatsDate(0, previous.updatedAt) : undefined);
    const sameScope = !policy.scope || previousScope === policy.scope;
    if (previous) {
      memory.set(key, previous);
      if (sameScope && now() - previous.updatedAt < ttl) {
        status(key, { updatedAt: previous.updatedAt, refreshing: false, saved: true, message: previous.message });
        if (previous.message) markNhlSaved(previous.value, previous.updatedAt, previous.message);
        else markNhlFetched(previous.value, previous.updatedAt);
        return previous.value;
      }
    }
    if (previous) markNhlSaved(previous.value, previous.updatedAt, previous.message);
    const running = pending.get(key) as Promise<T> | undefined;
    if (running) return previous && !policy.waitForRefresh ? previous.value : running;
    if (previous && sameScope && (failedUntil.get(key) ?? 0) > now()) return previous.value;
    status(key, { updatedAt: previous?.updatedAt, refreshing: true, saved: Boolean(previous) });
    const refresh = Promise.resolve().then(load).then(value => {
      if (!validate(value)) throw new Error('NHL returned an invalid complete dataset.');
      const source = nhlFreshness(value);
      const equalSource = Boolean(previous && source && source.updatedAt === previous.updatedAt);
      // A correction may change values without changing the scoreboard's time.
      // Keep rejecting older/stale data, but accept a changed fresh payload.
      const unchanged = previous && source && equalSource && !source.message && JSON.stringify(value) === JSON.stringify(previous.value);
      if (previous && source && (source.updatedAt < previous.updatedAt || equalSource && (source.message || unchanged))) {
        failedUntil.set(key, now() + (policy.staleRetryMs ?? 60_000));
        if (unchanged) {
          previous = { ...previous, message: undefined, baseline: undefined, scope: policy.scope };
          markNhlFetched(previous.value, previous.updatedAt);
          memory.set(key, previous); persist(prefix + key, previous);
        }
        status(key, { updatedAt: previous.updatedAt, refreshing: false, saved: true, message: source.message });
        return previous.value;
      }
      const entry = { value, updatedAt: source?.updatedAt ?? now(), message: source?.message, scope: policy.scope };
      if (entry.message) markNhlSaved(value, entry.updatedAt, entry.message);
      else markNhlFetched(value, entry.updatedAt);
      memory.set(key, entry);
      if (memory.size > 32) memory.delete(memory.keys().next().value!);
      persist(prefix + key, entry);
      if (source?.message) failedUntil.set(key, now() + 60_000); else failedUntil.delete(key);
      // A loader may have reported that only completed games were available.
      const message = entry.message;
      status(key, { updatedAt: entry.updatedAt, refreshing: false, saved: Boolean(message), message });
      if (previous) (options.onChange ?? changed)();
      return value;
    }).catch(error => {
      // Yesterday's completed total may replace a previous hockey day's live
      // total. On the same day retain live points; baseline-only saves may advance.
      if (error instanceof NhlBaselineAvailable && validate(error.value) && (!previous || !sameScope || previous.baseline)) {
        const source = nhlFreshness(error.value);
        const entry = { value: error.value, updatedAt: source?.updatedAt ?? now(), message: error.message, scope: policy.scope, baseline: true };
        markNhlSaved(entry.value, entry.updatedAt, entry.message);
        memory.set(key, entry); persist(prefix + key, entry);
        failedUntil.set(key, now() + 60_000);
        status(key, { updatedAt: entry.updatedAt, refreshing: false, saved: true, message: entry.message });
        if (previous) (options.onChange ?? changed)();
        return entry.value;
      }
      failedUntil.set(key, now() + 60_000);
      status(key, { updatedAt: previous?.updatedAt, refreshing: false, saved: Boolean(previous),
        message: previous ? 'NHL updates temporarily unavailable. Showing saved statistics.' : 'NHL statistics are not available yet.' });
      if (previous) return previous.value;
      throw error;
    }).finally(() => { pending.delete(key); });
    pending.set(key, refresh);
    // Stale-while-refresh is useful within one hockey day, but crossing the
    // 6 a.m. ET boundary must await a refresh attempt. Otherwise every new day
    // initially renders yesterday's standings from localStorage even when the
    // shared Worker already has fresh completed-game totals.
    if (previous && sameScope && !policy.waitForRefresh) { void refresh.catch(() => {}); return previous.value; }
    return refresh;
  };
}
export const savedNhl = createSavedNhlCache();
export function validPlayerRows(value: unknown): value is Array<{ playerId: number }> {
  return Array.isArray(value) && value.every(row => row && typeof row === 'object' && Number.isSafeInteger(row.playerId));
}
