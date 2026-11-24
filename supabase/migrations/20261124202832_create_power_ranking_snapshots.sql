create table public.power_ranking_snapshots (
  season_year integer not null,
  mode text not null,
  range_index integer not null,
  schema_version integer not null,
  generated_at timestamptz not null,
  stats_through date not null,
  results jsonb not null check (jsonb_typeof(results) = 'object'),
  primary key (season_year, mode, range_index),
  check ((mode = 'season' and range_index = 0)
      or (mode = 'month' and range_index between 0 and 6)
      or (mode = 'period' and range_index between 1 and 14))
);

alter table public.power_ranking_snapshots enable row level security;
revoke all on public.power_ranking_snapshots from public, anon, authenticated;
grant select on public.power_ranking_snapshots to authenticated;
grant select, insert, update on public.power_ranking_snapshots to service_role;

create policy "Signed-in users can read power rankings"
  on public.power_ranking_snapshots for select to authenticated
  using (auth.uid() is not null);
