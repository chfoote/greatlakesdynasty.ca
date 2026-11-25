create table public.record_book_nhl_ranges (
  season_year integer not null,
  start_date date not null,
  end_date date not null,
  schema_version integer not null check (schema_version = 1),
  generated_at timestamptz not null,
  skaters jsonb not null check (jsonb_typeof(skaters) = 'array'),
  goalies jsonb not null check (jsonb_typeof(goalies) = 'array'),
  primary key (season_year, start_date, end_date),
  check (start_date <= end_date)
);
alter table public.record_book_nhl_ranges enable row level security;
revoke all on public.record_book_nhl_ranges from public, anon, authenticated, service_role;
grant select on public.record_book_nhl_ranges to authenticated;
grant select, insert, update on public.record_book_nhl_ranges to service_role;
create policy "Signed-in members can read record NHL inputs"
  on public.record_book_nhl_ranges for select to authenticated
  using ((select auth.uid()) is not null);
