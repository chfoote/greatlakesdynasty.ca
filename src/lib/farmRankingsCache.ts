import type { FarmRanking } from './farmInsights';
import { nhlFreshness } from './nhlFreshness.ts';
export interface FarmRankingsSnapshot { seasonYear: number; updatedAt: number; rankings: FarmRanking[]; warning?: string; }

// Store only the public ranking display, never full roster rows, team notes,
// manager/account details, authentication, or the private insights object.
function displayRows(rows: FarmRanking[]): FarmRanking[] {
  return rows.map(row => ({ rank: row.rank, eligible: row.eligible, nhlActive: row.nhlActive,
    production: row.production, draftQuality: row.draftQuality, farmScore: row.farmScore,
    team: { id: row.team.id, team_name: row.team.team_name, abbreviation: row.team.abbreviation,
      logo: row.team.logo, primary_color: row.team.primary_color, secondary_color: row.team.secondary_color },
    topProspects: row.topProspects.map(prospect => ({ playerId: prospect.playerId, name: prospect.name,
      position: prospect.position, nhlTeam: prospect.nhlTeam, score: prospect.score,
      draftYear: prospect.draftYear, overallPick: prospect.overallPick })),
  }));
}
function validRows(value: unknown): value is FarmRanking[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && new Set(value.map(row => row?.team?.id)).size === value.length
    && value.every((row, index) => row && row.rank === index + 1 && Number.isSafeInteger(row.team?.id)
      && typeof row.team.team_name === 'string' && Array.isArray(row.topProspects)
      && ['eligible', 'nhlActive', 'production', 'draftQuality', 'farmScore'].every(key => Number.isFinite(row[key]))
      && row.topProspects.length <= 3 && row.topProspects.every((prospect: FarmRanking['topProspects'][number]) =>
        typeof prospect?.name === 'string' && typeof prospect.position === 'string' && Number.isFinite(prospect.score)
        && Number.isFinite(prospect.draftYear) && Number.isFinite(prospect.overallPick)));
}
export function createFarmRankingsCache(options: {
  seasonYear: number; load: () => Promise<FarmRanking[]>;
  now?: () => number; storage?: () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
}) {
  const key = `gld:public-farm-rankings:v1:${options.seasonYear}`;
  const now = options.now ?? Date.now;
  const storage = options.storage ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } });
  let memory: FarmRankingsSnapshot | undefined, pending: Promise<FarmRankingsSnapshot> | undefined;
  let failedUntil = 0;
  function read() {
    let value = memory;
    if (!value) { try { value = JSON.parse(storage()?.getItem(key) || 'null') ?? undefined; } catch { /* Optional cache. */ } }
    if (!value || value.seasonYear !== options.seasonYear || !Number.isFinite(value.updatedAt)
      || value.updatedAt > now() || now() - value.updatedAt > 7 * 86400_000 || !validRows(value.rankings)) return;
    memory = value;
    return value;
  }
  function load(): Promise<FarmRankingsSnapshot> {
    const saved = read();
    if (saved && now() - saved.updatedAt < 300_000 && !saved.warning) return Promise.resolve(saved);
    if (pending) return pending;
    if (failedUntil > now()) return Promise.reject(new Error('Ranking refresh is cooling down. Saved rankings remain available.'));
    pending = Promise.resolve().then(options.load).then(rows => {
      if (!validRows(rows)) throw new Error('The ranking data is incomplete. Saved rankings were kept.');
      const source = nhlFreshness(rows);
      if (saved && source && source.updatedAt <= saved.updatedAt) {
        failedUntil = now() + 60_000;
        return { ...saved, warning: source.message || 'Showing the last complete saved rankings.' };
      }
      const snapshot = { seasonYear: options.seasonYear, updatedAt: source?.updatedAt ?? now(),
        rankings: displayRows(rows), warning: source?.message };
      memory = snapshot;
      if (snapshot.warning) failedUntil = now() + 60_000; else failedUntil = 0;
      try { const encoded = JSON.stringify(snapshot); if (encoded.length * 2 <= 512_000) storage()?.setItem(key, encoded); }
      catch { /* Private/full storage must not prevent displaying live data. */ }
      return snapshot;
    }).catch(error => { failedUntil = now() + 60_000; throw error; })
      .finally(() => { pending = undefined; });
    return pending;
  }
  return { read, load };
}
