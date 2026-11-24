-- Public NHL inputs are stored separately from the browser's ranking payload.
-- Only the existing server role can write them; snapshot RLS remains unchanged.
alter table public.power_ranking_snapshots
  add column source_stats jsonb
  check (source_stats is null or jsonb_typeof(source_stats) = 'object');
