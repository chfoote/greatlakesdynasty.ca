create view public.record_book_range_players with (security_invoker = true) as
select season_year, start_date, end_date, schema_version,
  coalesce((select jsonb_agg(jsonb_build_object('playerId', p->'playerId', 'positionCode', p->'positionCode', 'gamesPlayed', p->'gamesPlayed')) from jsonb_array_elements(skaters) p), '[]'::jsonb)
  || coalesce((select jsonb_agg(jsonb_build_object('playerId', p->'playerId', 'positionCode', 'G', 'gamesPlayed', p->'gamesPlayed')) from jsonb_array_elements(goalies) p), '[]'::jsonb) as players
from public.record_book_nhl_ranges;
revoke all on public.record_book_range_players from public, anon, authenticated, service_role;
grant select on public.record_book_range_players to authenticated, service_role;
