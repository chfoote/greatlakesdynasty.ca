interface Player { playerId: number; }

// Publish current data before waiting for optional historical fallback data.
// The caller deliberately does not await this to render the manager dashboard.
export async function loadFrontOfficeNhl<S extends Player, G extends Player>(options: {
  currentSkaters: () => Promise<S[]>; previousSkaters: () => Promise<S[]>;
  currentGoalies: () => Promise<G[]>; previousGoalies: () => Promise<G[]>;
  onSkaters: (rows: S[]) => void; onGoalies: (rows: G[]) => void;
  onError: (error: unknown) => void;
  isActive?: () => boolean;
}) {
  async function load<T extends Player>(current: () => Promise<T[]>, previous: () => Promise<T[]>, publish: (rows: T[]) => void) {
    try {
      const rows = await current();
      if (options.isActive?.() === false) return;
      publish(rows);
      const historical = await previous();
      if (options.isActive?.() === false) return;
      const merged = new Map(historical.map(row => [row.playerId, row]));
      rows.forEach(row => merged.set(row.playerId, row));
      publish([...merged.values()]);
    } catch (error) { options.onError(error); }
  }
  await Promise.all([
    load(options.currentSkaters, options.previousSkaters, options.onSkaters),
    load(options.currentGoalies, options.previousGoalies, options.onGoalies),
  ]);
}
