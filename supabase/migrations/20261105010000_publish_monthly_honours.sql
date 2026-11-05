-- Monthly honours remain the source for profile badges and trophy cases.
alter table public.league_transactions drop constraint if exists league_transactions_type_check;
alter table public.league_transactions add constraint league_transactions_type_check
  check (transaction_type in ('signing', 'extension', 'trade', 'waiver', 'release', 'draft', 'news'));
alter table public.league_transactions drop constraint if exists league_transactions_action_check;
alter table public.league_transactions add constraint league_transactions_action_check
  check (action in ('signed', 'called_up', 'waived', 'claimed', 'bought_out', 'retained',
    'injured_reserve', 'long_term_injured_reserve', 'released_to_rfa_offer',
    'matched_rfa_offer', 'competitive_balance_drafted', 'traded', 'monthly_honour'));
alter table public.league_transactions add column monthly_honour_id bigint unique
  references public.monthly_player_honours(id) on delete cascade;

create or replace function public.post_league_transaction_to_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
  admin_name text;
  player_name text;
  team_name text;
  action_text text;
  chat_text text;
  chat_link text;
begin
  select p.id, coalesce(nullif(trim(p.display_name), ''), p.email, 'GLDHL Admin')
  into admin_id, admin_name
  from public.profiles p
  where lower(p.email) = 'sales@sg-print.com' and p.is_admin = true
  limit 1;
  if admin_id is null then return new; end if;

  if new.action = 'monthly_honour' then
    select coalesce(p.full_name, trim(concat_ws(' ', p.first_name, p.last_name)))
    into player_name from public.players p where p.id = new.player_id;
    chat_text := '🏆 ' || coalesce(player_name, 'Player') || ' — ' || new.description;
    chat_link := '/transactions#transaction-' || new.id;
  elsif new.trade_offer_id is not null then
    chat_text := 'A new trade has been approved and posted.';
    chat_link := '/transactions#trade-' || new.trade_offer_id;
  else
    select coalesce(p.full_name, trim(concat_ws(' ', p.first_name, p.last_name)), 'a player')
    into player_name from public.players p where p.id = new.player_id;

    select coalesce(b.team_name, t.team_name, 'A team')
    into team_name
    from public.fantasy_teams t
    left join lateral (
      select h.team_name from public.fantasy_team_branding_history h
      where h.fantasy_team_id = t.id
        and h.start_season <= new.season_year
        and (h.end_season is null or h.end_season >= new.season_year)
      order by h.start_season desc limit 1
    ) b on true
    where t.id = new.fantasy_team_id;

    action_text := case new.action
      when 'signed' then 'signed'
      when 'called_up' then 'called up'
      when 'waived' then 'waived'
      when 'claimed' then 'claimed'
      when 'bought_out' then 'bought out'
      when 'retained' then 'retained'
      when 'injured_reserve' then 'assigned to Injured Reserve'
      when 'long_term_injured_reserve' then 'assigned to Long Term Injured Reserve'
      when 'released_to_rfa_offer' then 'released to an RFA offer'
      when 'matched_rfa_offer' then 'matched an RFA offer for'
      when 'competitive_balance_drafted' then 'selected'
      when 'traded' then 'acquired via trade'
      else 'updated'
    end;

    chat_text := coalesce(team_name, 'A team') || ' have ' || action_text || ' '
      || case when new.action = 'competitive_balance_drafted' then '' when new.position is not null then upper(new.position) || ' ' else '' end
      || coalesce(nullif(player_name, ''), 'a player')
      || case when new.action = 'competitive_balance_drafted' then ' in the Competitive Balance Draft' else '' end
      || '.';
    chat_link := '/transactions';
  end if;

  begin
    perform set_config('app.system_chat', 'true', true);
    insert into public.chat_messages (user_id, message, author_name, is_system, link)
    values (admin_id, chat_text, admin_name, true, chat_link);
  exception when others then
    raise warning 'Unable to post transaction % to league chat: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
create or replace function public.publish_monthly_honour()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  award_month text;
  award_name text;
  period_end date;
begin
  -- Historical Season 1 syncs should not send fresh announcements.
  if new.season_year < 2027 then return new; end if;
  award_month := (array['October','November','December','January','February','March','April'])[new.month_index + 1];
  if new.season_year = 2027 and new.month_index = 0 then award_month := 'September / October'; end if;
  award_name := case new.category when 'forward' then 'Forward' when 'defenceman' then 'Defenceman' else 'Goalie' end || ' of the Month';
  period_end := (make_date(case when new.month_index < 3 then new.season_year - 1 else new.season_year end,
    case when new.month_index < 3 then new.month_index + 10 else new.month_index - 2 end, 1) + interval '1 month - 1 day')::date;
  if period_end >= (now() at time zone 'America/Toronto')::date then
    raise exception 'Monthly honours cannot be published before the award month is complete';
  end if;
  insert into public.league_transactions (monthly_honour_id, player_id, fantasy_team_id,
    transaction_type, action, transaction_date, season_year, description)
  values (new.id, new.player_id, new.fantasy_team_id, 'news', 'monthly_honour', period_end, new.season_year,
    award_month || ' · Season ' || new.season_year || ' · ' || award_name || ' · ' ||
    round(new.fantasy_points, 3) || ' FPTS · ' || new.games_played || ' GP')
  on conflict (monthly_honour_id) do update set
    player_id = excluded.player_id, fantasy_team_id = excluded.fantasy_team_id, description = excluded.description;
  -- Only inserts notify chat and enqueue Discord; repeated admin visits do not repost.
  return new;
end;
$$;
revoke all on function public.publish_monthly_honour() from public;
create trigger publish_monthly_honour after insert or update on public.monthly_player_honours
  for each row execute function public.publish_monthly_honour();

-- Publish saved current-season honours, without announcing all of Season 1 again.
update public.monthly_player_honours set updated_at = now()
where season_year = 2027 and month_index = 0;

-- Verified against the site's NHL period reports for 2026-09-29 through 2026-10-31.
-- Keep the same category and season convention used for Season 1 (2026).
insert into public.monthly_player_honours
  (season_year, month_index, category, player_id, fantasy_team_id, games_played, fantasy_points)
values
  (2027, 0, 'forward', 1, 5, 14, 116.45),
  (2027, 0, 'defenceman', 69, 3, 14, 80.4),
  (2027, 0, 'goalie', 246, 6, 13, 74.8)
on conflict (season_year, month_index, category) do nothing;
