create table public.farm_ranking_snapshots (
  season_year integer primary key,
  schema_version integer not null check (schema_version > 0),
  generated_at timestamptz not null,
  stats_through date not null,
  drafts_checked_at timestamptz not null,
  signature text not null check (signature ~ '^[0-9a-f]{64}$'),
  drafts jsonb not null check (jsonb_typeof(drafts) = 'array'),
  rankings jsonb not null check (jsonb_typeof(rankings) = 'array')
);
alter table public.farm_ranking_snapshots enable row level security;
revoke all on public.farm_ranking_snapshots from public, anon, authenticated, service_role;
grant select on public.farm_ranking_snapshots to authenticated;
grant select, insert, update on public.farm_ranking_snapshots to service_role;
create policy "Signed-in users can read farm rankings"
  on public.farm_ranking_snapshots for select to authenticated
  using ((select auth.uid()) is not null);
