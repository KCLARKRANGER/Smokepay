-- Fixes from the Supabase security advisor.

-- Pin the search path on the ledger trigger functions.
alter function smokepay_check_entry_balanced() set search_path = public;
alter function smokepay_forbid_change() set search_path = public;

-- The membership check no longer needs elevated rights: staff can already read
-- their own membership rows, so it runs as the caller. Signed-out visitors
-- cannot call it at all.
create or replace function is_store_member(p_store uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from store_members where store_id = p_store and user_id = auth.uid()
  );
$$;
revoke all on function is_store_member(uuid) from public, anon;
grant execute on function is_store_member(uuid) to authenticated, service_role;

-- provider_events has row-level security on and no policies on purpose: only
-- the server reads or writes partner events.
