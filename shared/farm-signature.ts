import type { FantasyTeam } from "../src/lib/fantasyTeams";
import type { ProspectOwnershipRow } from "../src/lib/prospectOwnership";
import type { NhlSkaterRecord, NhlGoalieRecord, NhlDraftPick } from "../src/lib/nhl";
import { getSkaterScore, getGoalieScore } from "./nhl-scoring.ts";
import { farmDate } from "./farm-rankings.ts";

export async function farmSignature(teams: FantasyTeam[], seasons: ProspectOwnershipRow[], drafts: Array<{year:number;picks:NhlDraftPick[]}>,
  stats: {skaters:NhlSkaterRecord[];goalies:NhlGoalieRecord[]}, date = farmDate()) {
  const input = {
    schema: 1,
    date: date.toDateString(),
    teams: [...teams].sort((a,b)=>a.id-b.id).map(t=>[t.id,t.team_name,t.abbreviation,t.logo??null,t.primary_color??null,t.secondary_color??null,t.eastern_farm_system??null,t.western_farm_system??null]),
    seasons: [...seasons].sort((a,b)=>a.id-b.id).map(s=>[s.id,s.season_year,s.updated_at,s.fantasy_team_id,s.position,s.player?.player_api_id,s.player?.full_name]),
    drafts: [...drafts].sort((a,b)=>a.year-b.year).map(d=>[d.year,[...d.picks].sort((a,b)=>a.overallPick-b.overallPick)
      .map(p=>[p.round??null,p.pickInRound??null,p.teamId??null,p.overallPick,p.firstName?.default??null,p.lastName?.default??null,
        p.positionCode??null,p.teamAbbrev,p.teamName?.default??null,p.teamCommonName?.default??null])]),
    skaters: [...stats.skaters].sort((a,b)=>a.playerId-b.playerId).map(s=>[s.playerId,s.skaterFullName,getSkaterScore(s),s.birthDate??null,s.teamAbbrevs??""]),
    goalies: [...stats.goalies].sort((a,b)=>a.playerId-b.playerId).map(s=>[s.playerId,s.goalieFullName,getGoalieScore(s),s.birthDate??null,s.teamAbbrevs??""]),
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
