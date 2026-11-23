// Public biography fields only. Never store fantasy rosters or account data.
export interface PlayerMetadata { playerId: number; birthCountry?: string; birthDate?: string; }
export function createPlayerMetadataCache(options: { now?: () => number; storage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined } = {}) {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } });
  const key = 'gld:public-player-bios:v1';
  let rows: Record<string, PlayerMetadata & { savedAt: number }> | undefined;
  const valid = (row: PlayerMetadata & { savedAt: number }) => row && Number.isSafeInteger(row.playerId) && row.playerId > 0
    && Number.isFinite(row.savedAt) && row.savedAt <= now() && now() - row.savedAt < 30 * 86400_000
    && (row.birthCountry === undefined || typeof row.birthCountry === 'string' && /^[A-Z]{3}$/.test(row.birthCountry))
    && (row.birthDate === undefined || typeof row.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.birthDate));
  function read(playerId: string | number) {
    if (!rows) {
      try { rows = JSON.parse(storage()?.getItem(key) || '{}'); } catch { /* Optional public cache. */ }
      if (!rows || typeof rows !== 'object' || Array.isArray(rows)) rows = {};
    }
    const row = rows[String(playerId)];
    return row && valid(row) ? row : undefined;
  }
  function remember(values: Array<{ playerId: number; birthCountry?: string; birthCountryCode?: string; birthDate?: string }>) {
    read(0);
    for (const value of values) {
      if (!Number.isSafeInteger(value.playerId) || value.playerId <= 0) continue;
      const country = value.birthCountryCode || value.birthCountry;
      const birthCountry = country && /^[A-Z]{3}$/.test(country.toUpperCase()) ? country.toUpperCase() : undefined;
      const birthDate = value.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(value.birthDate) ? value.birthDate : undefined;
      if (!birthCountry && !birthDate) continue;
      const previous = read(value.playerId);
      rows![String(value.playerId)] = { playerId: value.playerId, birthCountry: birthCountry || previous?.birthCountry,
        birthDate: birthDate || previous?.birthDate, savedAt: now() };
    }
    rows = Object.fromEntries(Object.entries(rows!).filter(([, row]) => valid(row)).slice(-2500));
    try { const text = JSON.stringify(rows); if (text.length * 2 <= 512_000) storage()?.setItem(key, text); } catch { /* Optional public cache. */ }
  }
  return { read, remember };
}
export const playerMetadata = createPlayerMetadataCache();
