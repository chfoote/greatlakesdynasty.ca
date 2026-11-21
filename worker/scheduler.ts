// Worker requests cannot rely on another request resolving their wait promise:
// workerd may cancel that continuation when its owner finishes. Share only
// counters/timestamps; every waiter schedules a timer in its own request context.
export function createWorkerScheduler(options: {
  maximum: number;
  statsGapMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maximumWaitMs?: number;
}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let active = 0;
  let statsActive = false;
  let nextStatsStart = 0;
  return async function schedule<T>(stats: boolean, work: () => Promise<T>): Promise<T> {
    const deadline = now() + (options.maximumWaitMs ?? 30_000);
    while (active >= options.maximum || (stats && (statsActive || now() < nextStatsStart))) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new WorkerQueueFullError("NHL request queue is busy. Please wait before refreshing.");
      const delay = stats && !statsActive && now() < nextStatsStart
        ? Math.min(250, nextStatsStart - now()) : 25;
      await sleep(Math.min(delay, remaining));
    }
    active++;
    if (stats) { statsActive = true; nextStatsStart = now() + options.statsGapMs; }
    try { return await work(); }
    finally { active--; if (stats) statsActive = false; }
  };
}

export class WorkerQueueFullError extends Error {}
