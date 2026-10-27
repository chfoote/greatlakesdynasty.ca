import type { FantasyTeam } from "../../lib/fantasyTeams";

const nhlTeamAbbreviations: Record<string, string> = {
  "anaheim ducks": "ANA", "boston bruins": "BOS", "buffalo sabres": "BUF", "calgary flames": "CGY",
  "carolina hurricanes": "CAR", "chicago blackhawks": "CHI", "colorado avalanche": "COL", "columbus blue jackets": "CBJ",
  "dallas stars": "DAL", "detroit red wings": "DET", "edmonton oilers": "EDM", "florida panthers": "FLA",
  "los angeles kings": "LAK", "minnesota wild": "MIN", "montreal canadiens": "MTL", "nashville predators": "NSH",
  "new jersey devils": "NJD", "new york islanders": "NYI", "new york rangers": "NYR", "ottawa senators": "OTT",
  "philadelphia flyers": "PHI", "pittsburgh penguins": "PIT", "san jose sharks": "SJS", "seattle kraken": "SEA",
  "st. louis blues": "STL", "st louis blues": "STL", "tampa bay lightning": "TBL", "toronto maple leafs": "TOR",
  "utah mammoth": "UTA", "utah hockey club": "UTA", "vancouver canucks": "VAN", "vegas golden knights": "VGK",
  "washington capitals": "WSH", "winnipeg jets": "WPG",
};

function affiliateAbbreviation(name?: string | null) {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return nhlTeamAbbreviations[normalized] || Object.entries(nhlTeamAbbreviations).find(([club]) => normalized.includes(club) || club.includes(normalized))?.[1] || null;
}

function Affiliate({ label, name }: { label: string; name?: string | null }) {
  const abbreviation = affiliateAbbreviation(name);
  return <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/90 p-1">
      {abbreviation ? <img src={`https://assets.nhle.com/logos/nhl/svg/${abbreviation}_light.svg`} alt={`${name} logo`} className="h-full w-full object-contain" /> : <span className="text-[9px] font-black text-gray-700">NHL</span>}
    </div>
    <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/55">{label}</p><p className="truncate text-xs font-semibold text-white/90">{name || "Not assigned"}</p></div>
  </div>;
}

export default function TeamIdentityCard({ team, season, managerName }: { team: FantasyTeam; season: number; managerName?: string | null }) {
  return <header className="relative overflow-hidden rounded-2xl bg-gray-950 p-4 text-white shadow-lg" style={{ backgroundImage: `linear-gradient(125deg, #111827 0%, ${team.primary_color || "#1d4ed8"} 72%, ${team.secondary_color || "#f97316"} 145%)` }}>
    <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border-[42px] border-white/5" />
    <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/25 bg-white p-1.5 shadow-lg">{team.logo ? <img src={team.logo} alt={`${team.team_name} logo`} className="h-full w-full object-contain" /> : <span className="text-lg font-black text-gray-900">{team.abbreviation}</span>}</div>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white/80">GLDHL Club</span><span className="rounded-full border border-white/20 bg-black/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">{team.abbreviation}</span></div><h1 className="mt-1.5 truncate text-2xl font-black tracking-tight sm:text-3xl">{team.team_name}</h1><p className="mt-1 text-xs text-white/65">Team #{team.id} · {season} season</p></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[560px]">
        <div className="rounded-xl border border-white/15 bg-black/20 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/55">Team Manager</p><p className="truncate text-xs font-bold">{managerName || team.manager_name || "Not set"}</p></div>
        <Affiliate label="Eastern affiliate" name={team.eastern_farm_system} />
        <Affiliate label="Western affiliate" name={team.western_farm_system} />
      </div>
    </div>
  </header>;
}
