-- Transfer primary league administration from Charles's personal account
-- to the dedicated GLDHL administration account.
-- Fail before changing anything if the replacement Auth user does not exist.

do $$
declare
  new_admin_id uuid;
begin
  select id into new_admin_id
  from auth.users
  where lower(email) = 'sales@sg-print.com'
  limit 1;

  if new_admin_id is null then
    raise exception 'Create the sales@sg-print.com account before applying this migration.';
  end if;

  insert into public.profiles (id, email, is_admin)
  values (new_admin_id, 'sales@sg-print.com', true)
  on conflict (id) do update
  set email = excluded.email,
      is_admin = true;

  update public.profiles
  set is_admin = false
  where lower(email) = 'charlesfoote13@gmail.com'
    and id <> new_admin_id;
end;
$$;
