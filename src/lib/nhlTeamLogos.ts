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

export function affiliateAbbreviation(name?: string | null) {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return nhlTeamAbbreviations[normalized] || Object.entries(nhlTeamAbbreviations).find(([club]) => normalized.includes(club) || club.includes(normalized))?.[1] || null;
}
