// Best-effort shared edge fallback. Cache API storage is per data centre and may
// be evicted; it is not a database or a permanent backup.
export function savedKey(request: Request) {
  const url = new URL(request.url);
  url.pathname = '/__gld_last_good' + url.pathname;
  return new Request(url, { method: 'GET' });
}
export function savedRetention(path: string) {
  return path.includes('/live-snapshot/') ? 6 * 3600 : path.includes('/score/') ? 86400 : 7 * 86400;
}
export function savedResponse(response: Response, failure: Response | undefined, now: number, path: string) {
  const savedAt = Number(response.headers.get('X-NHL-Saved-At'));
  if (!Number.isFinite(savedAt) || savedAt <= 0 || savedAt > now || now - savedAt > savedRetention(path) * 1000) return;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-NHL-Stale', '1');
  headers.set('X-NHL-Cache', 'STALE');
  if (failure) headers.set('X-NHL-Failure-Status', String(failure.status));
  const retry = failure?.headers.get('Retry-After');
  if (retry) headers.set('Retry-After', retry);
  return new Response(response.body, { status: 200, headers });
}
