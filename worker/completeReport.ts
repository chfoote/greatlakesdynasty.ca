export class CompleteReportError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly diagnostics: Record<string, string>;

  constructor(message: string, status: number, retryAfter: string | null = null, diagnostics: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.diagnostics = diagnostics;
  }
}

interface ReportPage {
  data: Array<{ playerId?: unknown }>;
  total: number;
}

const allowedExpression = /^seasonId=(\d{8}) and gameTypeId=2(?: and gameDate>="(\d{4}-\d{2}-\d{2})" and gameDate<="(\d{4}-\d{2}-\d{2})")?$/;
const stableSort = JSON.stringify([{ property: "playerId", direction: "ASC" }]);
const validDate = (value: string) => Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateCompleteReportQuery(url: URL) {
  // fetchCompleteNhlReport adds this fixed ordering and initial offset before
  // it knows the Worker will return the entire assembled report in one response.
  // Accept only those exact values; arbitrary pagination/query options remain rejected.
  if ([...url.searchParams.keys()].some((key) => !["cayenneExp", "sort", "start"].includes(key))) return;
  if (url.searchParams.has("sort") && url.searchParams.get("sort") !== stableSort) return;
  if (url.searchParams.has("start") && url.searchParams.get("start") !== "0") return;
  const expression = url.searchParams.get("cayenneExp") || "";
  const match = expression.match(allowedExpression);
  if (!match) return;
  const startYear = Number(match[1].slice(0, 4));
  const endYear = Number(match[1].slice(4));
  if (endYear !== startYear + 1) return;
  if ((match[2] && !match[3]) || (!match[2] && match[3])
    || (match[2] && (!validDate(match[2]) || !validDate(match[3]) || match[2] > match[3]))) return;
  return expression;
}

export async function buildCompleteReport(
  position: "skater" | "goalie",
  report: "summary" | "realtime" | "faceoffwins",
  expression: string,
  get: (path: string) => Promise<Response>,
) {
  const rows: ReportPage["data"] = [];
  const playerIds = new Set<number>();
  let expected: number | undefined;
  let savedAt: number | undefined;
  let failureStatus: string | undefined;

  // NHL league reports currently contain hundreds, not thousands, of players.
  // This hard bound keeps a malformed total safely below the Worker subrequest
  // ceiling instead of allowing a public request to fan out indefinitely.
  for (let page = 0; page < 30; page++) {
    const params = new URLSearchParams({
      limit: "500",
      isAggregate: "true",
      cayenneExp: expression,
      sort: stableSort,
      start: String(rows.length),
    });
    const response = await get(`/nhl-api/${position}/${report}?${params}`);
    if (!response.ok) {
      const diagnostics: Record<string, string> = {};
      for (const name of ["X-NHL-Source", "X-NHL-Upstream-Status", "X-NHL-Upstream-CF-Ray", "X-NHL-Upstream-Server"]) {
        const value = response.headers.get(name);
        if (value) diagnostics[name] = value;
      }
      throw new CompleteReportError("Unable to assemble a complete NHL statistics report.", response.status,
        response.headers.get("Retry-After"), diagnostics);
    }
    if (response.headers.get("X-NHL-Stale") === "1") {
      const timestamp = Number(response.headers.get("X-NHL-Saved-At"));
      if (!Number.isFinite(timestamp) || timestamp <= 0) throw new CompleteReportError("Saved NHL report page is missing its timestamp.", 502);
      savedAt = Math.min(savedAt ?? timestamp, timestamp);
      failureStatus ||= response.headers.get("X-NHL-Failure-Status") || undefined;
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new CompleteReportError("NHL returned invalid statistics JSON.", 502); }
    const candidate = payload as { data?: unknown; total?: unknown } | null;
    if (!candidate || !Array.isArray(candidate.data) || typeof candidate.total !== "number"
      || !Number.isSafeInteger(candidate.total) || candidate.total < 0 || candidate.total > 2_500) {
      throw new CompleteReportError("NHL returned an invalid statistics report.", 502);
    }
    const result = candidate as ReportPage;
    if (expected === undefined) expected = result.total;
    else if (result.total !== expected) throw new CompleteReportError("NHL statistics changed while the complete report was loading.", 503);
    if (rows.length + result.data.length > expected) throw new CompleteReportError("NHL returned inconsistent player counts.", 502);
    for (const row of result.data) {
      if (!row || typeof row !== "object" || !Number.isSafeInteger(row.playerId)) {
        throw new CompleteReportError("NHL returned an invalid player row.", 502);
      }
      const playerId = row.playerId as number;
      if (playerIds.has(playerId)) throw new CompleteReportError("NHL repeated a statistics page.", 502);
      playerIds.add(playerId);
      rows.push(row);
    }
    if (rows.length === expected) return { data: rows, total: expected, savedAt, failureStatus };
    if (!result.data.length) throw new CompleteReportError(`NHL report is incomplete (${rows.length} of ${expected}).`, 502);
  }
  throw new CompleteReportError("NHL report exceeded the safe page limit.", 502);
}
