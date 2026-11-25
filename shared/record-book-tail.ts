import type {RecordStats} from './record-book-stats.ts';
import type {NhlGoalieRecord,NhlSkaterRecord} from '../src/lib/nhl';
// Closed spans partition the season. Subtract their additive totals from the
// complete saved season to obtain the remaining ownership tail without another
// NHL report. Goalies' raw seconds played preserve the provider's GAA precision.
export function recordBookTail(full:RecordStats,prefixes:RecordStats[]):RecordStats|null {
  const skaterFields=['gamesPlayed','goals','assists','plusMinus','penaltyMinutes','ppGoals','ppPoints','shGoals','shPoints','gameWinningGoals','shots','blockedShots','hits','totalFaceoffWins'] as const;
  const goalieFields=['gamesPlayed','gamesStarted','wins','losses','otLosses','goalsAgainst','saves','shutouts','penaltyMinutes','goals','assists'] as const;
  let invalid=false;
  function subtract<T extends {playerId:number;gamesPlayed:number}>(rows:T[],prior:T[],fields:readonly string[]) {
    const totals=new Map<number,Record<string,number>>();
    prior.forEach(row=>{const sum=totals.get(row.playerId)??{};fields.forEach(field=>{const value=(row as unknown as Record<string,number>)[field];if(!Number.isFinite(value))invalid=true;sum[field]=(sum[field]??0)+value});totals.set(row.playerId,sum)});
    const ids=new Set(rows.map(row=>row.playerId));if([...totals.keys()].some(id=>!ids.has(id)))invalid=true;
    return rows.map(row=>{const result={...row} as T & Record<string,number>;
      fields.forEach(field=>{const value=(row as unknown as Record<string,number>)[field]-(totals.get(row.playerId)?.[field]??0);if(!Number.isFinite(value)||(field!=='plusMinus'&&value<0))invalid=true;(result as Record<string,number>)[field]=value});return result;
    }).filter(row=>row.gamesPlayed>0);
  }
  const skaters=subtract(full.skaters,prefixes.flatMap(p=>p.skaters),skaterFields);
  const goalies=subtract(full.goalies,prefixes.flatMap(p=>p.goalies),[...goalieFields,'timeOnIce']).map(row=>{
    if(row.timeOnIce<=0)invalid=true;
    return {...row,goalsAgainstAverage:Math.floor(row.goalsAgainst*3600/row.timeOnIce*100000)/100000,
      savePct:row.saves+row.goalsAgainst?Math.floor(row.saves/(row.saves+row.goalsAgainst)*100000)/100000:null};
  });
  return invalid?null:{skaters:skaters as NhlSkaterRecord[],goalies:goalies as NhlGoalieRecord[]};
}
