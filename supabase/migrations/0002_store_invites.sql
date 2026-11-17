-- Store invites: an owner or manager invites a staff email to a store. When a
-- person with that email signs in for the first time (or already has an
-- account), they are linked to the store with the invited role.

create table store_invites (
  store_id uuid not null references stores (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%_@_%'),
  role text not null check (role in ('owner', 'manager', 'cashier')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (store_id, email)
);

alter table store_invites enable row level security;
create policy store_invites_read on store_invites for select to authenticated
  using (is_store_member(store_id));
revoke insert, update, delete, truncate on store_invites from anon, authenticated;

-- Links every open invite for an email to the given user.
create function sp_accept_invites(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  inv record;
begin
  for inv in
    select * from store_invites
    where email = lower(p_email) and accepted_at is null
    for update
  loop
    insert into store_members (store_id, user_id, role)
      values (inv.store_id, p_user, inv.role)
      on conflict (store_id, user_id) do update set role = excluded.role;
    update store_invites set accepted_at = now()
      where store_id = inv.store_id and email = inv.email;
    insert into audit_log (store_id, actor, action, detail)
      values (inv.store_id, p_user, 'member.joined', jsonb_build_object('role', inv.role));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Creates an invite. If the person already has an account, links them now.
create function sp_invite(p_store uuid, p_actor uuid, p_email text, p_role text)
returns store_invites
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  inv store_invites;
  existing uuid;
begin
  if p_actor is not null then
    select role into actor_role from store_members where store_id = p_store and user_id = p_actor;
    if actor_role is null or actor_role not in ('owner', 'manager') then
      raise exception 'not_allowed';
    end if;
    -- Managers cannot create owners.
    if actor_role = 'manager' and p_role = 'owner' then
      raise exception 'not_allowed';
    end if;
  end if;

  insert into store_invites (store_id, email, role, invited_by)
    values (p_store, lower(trim(p_email)), p_role, p_actor)
    on conflict (store_id, email) do update
      set role = excluded.role, invited_by = excluded.invited_by, accepted_at = null
    returning * into inv;
  insert into audit_log (store_id, actor, action, detail)
    values (p_store, p_actor, 'member.invited', jsonb_build_object('role', p_role));

  select id into existing from auth.users where lower(email) = inv.email limit 1;
  if existing is not null then
    perform sp_accept_invites(existing, inv.email);
    select * into inv from store_invites where store_id = p_store and email = inv.email;
  end if;
  return inv;
end $$;

create function sp_on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null then
    perform sp_accept_invites(new.id, new.email);
  end if;
  return new;
end $$;

create trigger smokepay_accept_invites
  after insert on auth.users
  for each row execute function sp_on_auth_user_created();

revoke all on function sp_accept_invites(uuid, text) from public, anon, authenticated;
revoke all on function sp_invite(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function sp_on_auth_user_created() from public, anon, authenticated;
grant execute on function sp_invite(uuid, uuid, text, text) to service_role;
