// Public biography fields only. Never store fantasy rosters or account data.
export interface PlayerMetadata { playerId: number; birthCountry?: string; birthDate?: string; currentTeamAbbrev?: string; }
export function createPlayerMetadataCache(options: { now?: () => number; storage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined } = {}) {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } });
  const key = 'gld:public-player-bios:v1';
  type SavedPlayerMetadata = PlayerMetadata & { savedAt: number; currentTeamSavedAt?: number };
  let rows: Record<string, SavedPlayerMetadata> | undefined;
  const valid = (row: SavedPlayerMetadata) => row && Number.isSafeInteger(row.playerId) && row.playerId > 0
    && Number.isFinite(row.savedAt) && row.savedAt <= now() && now() - row.savedAt < 30 * 86400_000
    && (row.birthCountry === undefined || typeof row.birthCountry === 'string' && /^[A-Z]{3}$/.test(row.birthCountry))
    && (row.birthDate === undefined || typeof row.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.birthDate))
    && (row.currentTeamAbbrev === undefined || typeof row.currentTeamAbbrev === 'string' && /^[A-Z]{2,4}$/.test(row.currentTeamAbbrev));
  function read(playerId: string | number) {
    if (!rows) {
      try { rows = JSON.parse(storage()?.getItem(key) || '{}'); } catch { /* Optional public cache. */ }
      if (!rows || typeof rows !== 'object' || Array.isArray(rows)) rows = {};
    }
    const row = rows[String(playerId)];
    if (!row || !valid(row)) return undefined;
    // Biographical fields rarely change, but a club can change at any trade.
    // Keep that part quick without allowing it to remain stale for weeks.
    const teamSavedAt = row.currentTeamSavedAt ?? row.savedAt;
    return row.currentTeamAbbrev && now() - teamSavedAt >= 86400_000
      ? { ...row, currentTeamAbbrev: undefined }
      : row;
  }
  function remember(values: Array<{ playerId: number; birthCountry?: string; birthCountryCode?: string; birthDate?: string; currentTeamAbbrev?: string }>) {
    read(0);
    for (const value of values) {
      if (!Number.isSafeInteger(value.playerId) || value.playerId <= 0) continue;
      const country = value.birthCountryCode || value.birthCountry;
      const birthCountry = country && /^[A-Z]{3}$/.test(country.toUpperCase()) ? country.toUpperCase() : undefined;
      const birthDate = value.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(value.birthDate) ? value.birthDate : undefined;
      const currentTeamAbbrev = value.currentTeamAbbrev && /^[A-Z]{2,4}$/.test(value.currentTeamAbbrev.toUpperCase())
        ? value.currentTeamAbbrev.toUpperCase() : undefined;
      if (!birthCountry && !birthDate && !currentTeamAbbrev) continue;
      const previous = read(value.playerId);
      rows![String(value.playerId)] = { playerId: value.playerId, birthCountry: birthCountry || previous?.birthCountry,
        birthDate: birthDate || previous?.birthDate, currentTeamAbbrev: currentTeamAbbrev || previous?.currentTeamAbbrev,
        currentTeamSavedAt: currentTeamAbbrev ? now() : previous?.currentTeamSavedAt, savedAt: now() };
    }
    rows = Object.fromEntries(Object.entries(rows!).filter(([, row]) => valid(row)).slice(-2500));
    try { const text = JSON.stringify(rows); if (text.length * 2 <= 512_000) storage()?.setItem(key, text); } catch { /* Optional public cache. */ }
  }
  return { read, remember };
}
export const playerMetadata = createPlayerMetadataCache();
