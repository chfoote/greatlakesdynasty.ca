create table public.team_cap_adjustment_totals (
  fantasy_team_id bigint not null references public.fantasy_teams(id) on delete cascade,
  season_year integer not null,
  buyout_penalty_total bigint not null default 0 check (buyout_penalty_total >= 0),
  retention_net bigint not null default 0,
  buyout_slots_used integer not null default 0 check (buyout_slots_used >= 0),
  retention_slots_used integer not null default 0 check (retention_slots_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (fantasy_team_id, season_year)
);

comment on table public.team_cap_adjustment_totals is
  'Public-safe team and season cap totals. Player-level buyout and retention records remain protected by RLS.';

alter table public.team_cap_adjustment_totals enable row level security;

create policy "Public can read team cap adjustment totals"
  on public.team_cap_adjustment_totals
  for select
  to anon, authenticated
  using (true);

grant select on public.team_cap_adjustment_totals to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.team_cap_adjustment_totals from anon, authenticated;

create or replace function public.refresh_team_cap_adjustment_total(
  p_fantasy_team_id bigint,
  p_season_year integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_fantasy_team_id is null or p_season_year is null then
    return;
  end if;

  insert into public.team_cap_adjustment_totals (
    fantasy_team_id,
    season_year,
    buyout_penalty_total,
    retention_net,
    buyout_slots_used,
    retention_slots_used,
    updated_at
  )
  select
    p_fantasy_team_id,
    p_season_year,
    coalesce((
      select sum(p.amount)::bigint
      from public.buyout_cap_penalties p
      where p.fantasy_team_id = p_fantasy_team_id
        and p.season_year = p_season_year
    ), 0),
    coalesce((
      select sum(r.amount)::bigint
      from public.retention_cap_adjustments r
      where r.fantasy_team_id = p_fantasy_team_id
        and r.season_year = p_season_year
    ), 0),
    coalesce((
      select count(distinct p.buyout_id)::integer
      from public.buyout_cap_penalties p
      where p.fantasy_team_id = p_fantasy_team_id
        and p.season_year = p_season_year
    ), 0),
    coalesce((
      select count(distinct r.retention_id)::integer
      from public.retention_cap_adjustments r
      where r.fantasy_team_id = p_fantasy_team_id
        and r.season_year = p_season_year
        and r.adjustment_type = 'charge'
    ), 0),
    now()
  on conflict (fantasy_team_id, season_year) do update
    set buyout_penalty_total = excluded.buyout_penalty_total,
        retention_net = excluded.retention_net,
        buyout_slots_used = excluded.buyout_slots_used,
        retention_slots_used = excluded.retention_slots_used,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.refresh_team_cap_adjustment_total(bigint, integer) from public, anon, authenticated;

create or replace function public.sync_team_cap_adjustment_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_team_cap_adjustment_total(old.fantasy_team_id, old.season_year);
  end if;
  if tg_op <> 'DELETE' then
    perform public.refresh_team_cap_adjustment_total(new.fantasy_team_id, new.season_year);
  end if;
  return null;
end;
$$;

revoke all on function public.sync_team_cap_adjustment_total() from public, anon, authenticated;

create trigger sync_buyout_cap_adjustment_totals
after insert or update or delete on public.buyout_cap_penalties
for each row execute function public.sync_team_cap_adjustment_total();

create trigger sync_retention_cap_adjustment_totals
after insert or update or delete on public.retention_cap_adjustments
for each row execute function public.sync_team_cap_adjustment_total();

insert into public.team_cap_adjustment_totals (
  fantasy_team_id,
  season_year,
  buyout_penalty_total,
  retention_net,
  buyout_slots_used,
  retention_slots_used
)
select
  keys.fantasy_team_id,
  keys.season_year,
  coalesce(b.buyout_penalty_total, 0),
  coalesce(r.retention_net, 0),
  coalesce(b.buyout_slots_used, 0),
  coalesce(r.retention_slots_used, 0)
from (
  select fantasy_team_id, season_year from public.buyout_cap_penalties
  union
  select fantasy_team_id, season_year from public.retention_cap_adjustments
) keys
left join (
  select fantasy_team_id, season_year, sum(amount)::bigint as buyout_penalty_total,
    count(distinct buyout_id)::integer as buyout_slots_used
  from public.buyout_cap_penalties
  group by fantasy_team_id, season_year
) b using (fantasy_team_id, season_year)
left join (
  select fantasy_team_id, season_year, sum(amount)::bigint as retention_net,
    count(distinct retention_id) filter (where adjustment_type = 'charge')::integer as retention_slots_used
  from public.retention_cap_adjustments
  group by fantasy_team_id, season_year
) r using (fantasy_team_id, season_year);
