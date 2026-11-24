#!/usr/bin/env bash
set -euo pipefail

container=$(docker run --rm -d --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)
trap 'docker stop "$container" >/dev/null' EXIT

for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -h 127.0.0.1 -q; then
    break
  fi
  sleep 1
done

run_sql() {
  docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -q
}

# Minimal copies of the role and session interfaces used by the migration.
run_sql <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
grant usage on schema auth to authenticated;
create function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
SQL

run_sql < supabase/migrations/20261124202832_create_power_ranking_snapshots.sql
run_sql < supabase/migrations/20261124204724_add_power_ranking_snapshot_sources.sql

run_sql <<'SQL'
set role service_role;
insert into public.power_ranking_snapshots
  (season_year, mode, range_index, schema_version, generated_at, stats_through, results)
values (2027, 'month', 0, 1, now(), '2026-10-31', '{"teamRankings":[]}'::jsonb)
on conflict (season_year, mode, range_index) do update set results = excluded.results;
reset role;

set role anon;
do $$ begin
  perform * from public.power_ranking_snapshots;
  raise exception 'Anonymous role could read snapshots';
exception when insufficient_privilege then null;
end $$;
reset role;

set role authenticated;
do $$ begin
  if exists (select from public.power_ranking_snapshots) then
    raise exception 'Missing user ID did not block reads';
  end if;
end $$;
set request.jwt.claim.sub = '75acabbb-5700-4e5f-a962-fc8b382f3f25';
do $$ begin
  if (select count(*) from public.power_ranking_snapshots) <> 1 then
    raise exception 'Signed-in user could not read the published snapshot';
  end if;
  update public.power_ranking_snapshots set results = '{}'::jsonb;
  raise exception 'Signed-in user could alter a snapshot';
exception when insufficient_privilege then null;
end $$;
SQL

echo "Snapshot migration and anonymous, signed-in, and server permissions passed."
