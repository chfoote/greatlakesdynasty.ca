import { nhlFetch } from "./nhlRequest.ts";

interface ReportPage<T> {
  data: T[];
  total: number;
}

// Keep paging sequential within each report. nhlFetch supplies the shared
// concurrency limit, success caching, in-flight deduplication and 429 cooldown.
export async function fetchCompleteNhlReport<T>(
  path: string,
  label: string,
  fetcher: (path: string) => Promise<Response> = nhlFetch,
): Promise<T[]> {
  const url = new URL(path, "https://nhl-report.invalid");
  // Stable ordering is necessary when one report spans several API pages.
  // This also gives the complete-report reader different cache keys from the
  // old queries that could have cached a truncated response.
  if (!url.searchParams.has("sort")) {
    url.searchParams.set("sort", JSON.stringify([{ property: "playerId", direction: "ASC" }]));
  }
  url.searchParams.set("start", "0");
  const rows: T[] = [];
  let expected: number | undefined;
  const seenPages = new Set<string>();

  for (let page = 0; page < 100; page++) {
    const response = await fetcher(url.pathname + url.search);
    if (!response.ok) throw new Error(`Unable to load NHL ${label} (${response.status})`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)
      || !("total" in payload) || typeof payload.total !== "number"
      || !Number.isSafeInteger(payload.total) || payload.total < 0 || payload.total > 50_000) {
      throw new Error(`NHL ${label} returned an invalid report. Statistics were not loaded.`);
    }
    const result = payload as ReportPage<T>;
    if (expected === undefined) expected = result.total;
    else if (result.total !== expected) {
      // A changing dataset must not silently produce incomplete/duplicated totals.
      // Do not retry automatically: a later user refresh can fetch a stable report.
      throw new Error(`NHL ${label} changed while loading. Please refresh after a short wait.`);
    }
    if (rows.length + result.data.length > expected) {
      throw new Error(`NHL ${label} returned inconsistent player counts.`);
    }
    const fingerprint = JSON.stringify(result.data);
    if (result.data.length && seenPages.has(fingerprint)) {
      throw new Error(`NHL ${label} repeated a page. Partial statistics were not loaded.`);
    }
    seenPages.add(fingerprint);
    rows.push(...result.data);
    if (rows.length === expected) return rows;
    if (!result.data.length) {
      throw new Error(`NHL ${label} is incomplete (${rows.length} of ${expected} records).`);
    }
    // Request only missing pages when limit=-1 did not actually return everything.
    // The offset advances by actual rows returned, including provider page caps.
    url.searchParams.set("start", String(rows.length));
    url.searchParams.set("limit", "500");
  }
  throw new Error(`NHL ${label} exceeded the page limit. Partial statistics were not loaded.`);
}
