import type { PlayerSeasonWithRelations } from './fantasyPlayers';
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const prospectPositions = new Set(['PROSPECT', 'AP']);

// Preserve the existing signing/rights rules, but index each roster row once
// instead of normalizing and sorting the entire roster for every draft pick.
export function createProspectOwnershipIndex(seasons: PlayerSeasonWithRelations[]) {
  const signedIds = new Set<string>(), signedNames = new Set<string>();
  const latestIds = new Map<string, PlayerSeasonWithRelations>(), latestNames = new Map<string, PlayerSeasonWithRelations>();
  function remember(map: Map<string, PlayerSeasonWithRelations>, key: string, row: PlayerSeasonWithRelations) {
    const previous = map.get(key);
    if (!previous || row.season_year > previous.season_year
      || (row.season_year === previous.season_year && row.updated_at > previous.updated_at)) map.set(key, row);
  }
  for (const row of seasons) {
    if (!row.fantasy_team_id) continue;
    const id = row.player?.player_api_id, name = normalize(row.player?.full_name || '');
    if (!prospectPositions.has((row.position || '').toUpperCase())) {
      if (id) signedIds.add(id);
      signedNames.add(name);
    }
    if (id) remember(latestIds, id, row);
    remember(latestNames, name, row);
  }
  return {
    wasSigned(name: string, playerId?: number) { return playerId ? signedIds.has(String(playerId)) : signedNames.has(normalize(name)); },
    rightsTeam(name: string, playerId?: number) {
      const row = playerId ? latestIds.get(String(playerId)) : latestNames.get(normalize(name));
      return row && prospectPositions.has((row.position || '').toUpperCase()) ? row.fantasy_team_id : null;
    },
  };
}
