import {useEffect,useMemo,useState} from "react";
import {Link} from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import RecordBookTabs from "../../components/hockey/RecordBookTabs";
import PositionBadge,{normalizePosition} from "../../components/hockey/PositionBadge";
import {fetchRecordBookInputs} from "../../lib/recordBookInputs";
import {buildCareerEarnings} from "../../lib/careerEarnings";
import {CURRENT_LEAGUE_SEASON} from "../../lib/leagueSeasons";
const money=new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",maximumFractionDigits:0});
const positions=["C","LW","RW","D","G"] as const;
type EarningsSort="earned"|"total"|"salary"|"end";
export default function CareerEarnings(){
  const [inputs,setInputs]=useState<Awaited<ReturnType<typeof fetchRecordBookInputs>>|null>(null);
  const [error,setError]=useState("");const [retry,setRetry]=useState(0);const [search,setSearch]=useState("");const [sortBy,setSortBy]=useState<EarningsSort>("earned");const [positionFilter,setPositionFilter]=useState("all");const [teamFilter,setTeamFilter]=useState("all");
  useEffect(()=>{let active=true;setError("");void fetchRecordBookInputs().then(data=>{if(active)setInputs(data)}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Unable to load career earnings.")});return()=>{active=false}},[retry]);
  const rankings=useMemo(()=>{
    if(!inputs)return [];
    const earned=new Map(buildCareerEarnings(inputs.allSeasons,inputs.transactions).map(row=>[row.key,row]));
    const rosterByPlayer=new Map<string,typeof inputs.allSeasons>();
    inputs.allSeasons.forEach(season=>{const id=season.player?.player_api_id;if(id)rosterByPlayer.set(id,[...(rosterByPlayer.get(id)||[]),season])});
    return buildCareerEarnings(inputs.allSeasons,inputs.transactions,true).map(row=>{
      const roster=(rosterByPlayer.get(row.playerId)||[]).sort((a,b)=>b.season_year-a.season_year||b.id-a.id);
      const teamSeason=roster.find(season=>season.fantasy_team_id)||roster[0];
      const positionSeason=roster.find(season=>positions.includes(normalizePosition(season.position) as typeof positions[number]));
      return {...row,earned:earned.get(row.key)?.total??0,earnedYears:earned.get(row.key)?.years.length??0,position:normalizePosition(positionSeason?.position),teamId:teamSeason?.fantasy_team_id??null,teamName:teamSeason?.fantasy_team?.team_name||"",teamAbbreviation:teamSeason?.fantasy_team?.abbreviation||"",annualSalary:row.years[row.years.length-1]?.salary||0,contractEnd:row.years[row.years.length-1]?.year||0};
    }).sort((a,b)=>{
        if(sortBy==="total")return b.total-a.total||a.playerName.localeCompare(b.playerName);
        if(sortBy==="salary")return b.annualSalary-a.annualSalary||b.total-a.total||a.playerName.localeCompare(b.playerName);
        if(sortBy==="end")return b.contractEnd-a.contractEnd||b.total-a.total||a.playerName.localeCompare(b.playerName);
        return b.earned-a.earned||a.playerName.localeCompare(b.playerName);
      })
      .map((row,index)=>({...row,rank:index+1}));
  },[inputs,sortBy]);
  const visible=rankings.filter(row=>(positionFilter==="all"||row.position===positionFilter)
    &&(teamFilter==="all"||row.teamId===Number(teamFilter))
    &&(!search.trim()||[row.playerName,row.teamName,row.teamAbbreviation].some(value=>value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))));
  const visibleTeams=useMemo(()=>inputs?.teams.filter(team=>rankings.some(row=>row.teamId===team.id)).sort((a,b)=>a.team_name.localeCompare(b.team_name))||[],[inputs,rankings]);
  return <div><PageMeta title="Career Earnings | Contracts & Earnings | GLDHL" description="GLDHL player career contract earnings and years under contract"/><PageBreadcrumb pageTitle="Contracts & Earnings"/>
    <div className="space-y-5"><section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"><RecordBookTabs active="Career Earnings"/></section>
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-200 p-4 dark:border-gray-800 sm:p-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">League Earnings Database</p><div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-xl font-black text-gray-900 dark:text-white">Career Earnings</h1><p className="text-xs text-gray-500">Annual salary totals by player, including the remaining value of recorded contracts.</p></div><p className="text-xs font-bold text-gray-500">{visible.length} of {rankings.length} players</p></div>
        <p className="mt-2 text-xs text-gray-500">Signing history fills cleared roster records through the buyout season. Earned so far includes the full current-season salary; amounts are annual contract values, not prorated payments.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_10rem_minmax(12rem,16rem)_12rem]">
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-500">Search<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Player or team" className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"/></label>
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-500">Position<select value={positionFilter} onChange={event=>setPositionFilter(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"><option value="all">All positions</option>{positions.map(position=><option key={position} value={position}>{position}</option>)}</select></label>
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-500">Current Team<select value={teamFilter} onChange={event=>setTeamFilter(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"><option value="all">All teams</option>{visibleTeams.map(team=><option key={team.id} value={team.id}>{team.team_name}</option>)}</select></label>
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-500">Sort By<select value={sortBy} onChange={event=>setSortBy(event.target.value as EarningsSort)} className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"><option value="earned">Earned so far</option><option value="total">Total value</option><option value="salary">Annual salary</option><option value="end">Contract end</option></select></label>
        </div></div>
        {error?<div role="alert" className="m-4 rounded-xl border border-error-200 p-4 text-error-600"><p>{error}</p><button type="button" onClick={()=>setRetry(value=>value+1)} className="mt-2 rounded-lg border px-3 py-2 font-bold">Retry</button></div>:!inputs?<p role="status" className="p-5 text-gray-500">Loading career earnings…</p>:<div className="overflow-x-auto"><table className="min-w-[1180px] w-full text-sm"><thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 dark:bg-gray-900"><tr><th className="px-3 py-3 text-center">Rank</th><th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-center dark:bg-gray-900">Player</th><th className="px-3 py-3 text-center">Pos</th><th className="px-3 py-3 text-center">Current Team</th><th className="px-3 py-3 text-center">Earned so far</th><th className="px-3 py-3 text-center">Total contract value</th><th className="px-3 py-3 text-center">Years earned / total</th><th className="px-3 py-3 text-center">Contract seasons</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-800">{visible.map((row,index)=><tr key={row.key} className="text-gray-600 hover:bg-emerald-50/50 dark:text-gray-300 dark:hover:bg-emerald-500/[0.05]"><td className="px-3 py-3 text-center text-xs font-black text-gray-400">{index+1}</td><th scope="row" className="sticky left-0 z-10 bg-white px-3 py-3 text-center dark:bg-gray-950"><span className="flex items-center justify-center gap-2">{row.playerId?<Link to={`/player-profile?playerId=${encodeURIComponent(row.playerId)}`} className="font-black text-gray-900 hover:text-brand-500 dark:text-white">{row.playerName}</Link>:row.playerName}</span></th><td className="px-3 py-3 text-center"><PositionBadge position={row.position}/></td><td className="px-3 py-3 text-center font-bold">{row.teamAbbreviation||"—"}</td><td className="whitespace-nowrap px-3 py-3 text-center font-black text-emerald-700 dark:text-emerald-300">{money.format(row.earned)}</td><td className="whitespace-nowrap px-3 py-3 text-center font-black text-gray-900 dark:text-white">{money.format(row.total)}</td><td className="px-3 py-3 text-center font-bold">{row.earnedYears} / {row.years.length}</td><td className="px-3 py-3 text-center"><details className="inline-block text-left"><summary className="cursor-pointer whitespace-nowrap font-semibold text-gray-500">{row.years.map(year=>year.year).join(", ")}</summary><ul className="absolute z-20 mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-left text-xs text-gray-500 shadow-lg dark:border-gray-700 dark:bg-gray-900">{row.years.map(year=><li key={year.year} className="whitespace-nowrap py-1">{year.year} · {money.format(year.salary)} · {year.teamName}{year.year>CURRENT_LEAGUE_SEASON?" · Future":" · Included in earned so far"}</li>)}</ul></details></td></tr>)}</tbody></table>{!visible.length&&<p className="p-6 text-center text-gray-500">{rankings.length?"No players match your filters.":"No recorded contract earnings are available."}</p>}</div>}
      </section>
    </div></div>;
}
