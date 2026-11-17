-- SmokePay core schema.
-- Money is stored as integer cents. Every state change that moves money runs
-- inside one database function so it is atomic, and every journal entry must
-- balance before the transaction can commit.

-- ---------------------------------------------------------------- tables

create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_number text,
  -- Payment partner adapter id for this store. Null means no partner is
  -- connected and customer checkout stays closed.
  provider text,
  provider_merchant_ref text,
  -- Real money is only allowed when this is true.
  live boolean not null default false,
  created_at timestamptz not null default now()
);

create table store_members (
  store_id uuid not null references stores (id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'manager', 'cashier')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table payment_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id),
  order_ref text not null check (length(order_ref) between 1 and 64),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 500000),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'open' check (
    status in ('open', 'processing', 'paid', 'failed', 'canceled', 'expired',
               'partially_refunded', 'refunded')
  ),
  -- Only the SHA-256 hash of the customer link token is stored.
  token_hash text not null unique,
  customer_phone_last4 text check (customer_phone_last4 ~ '^[0-9]{4}$'),
  created_by uuid not null,
  provider text,
  provider_ref text,
  idempotency_key text not null,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);

create unique index payment_sessions_provider_ref
  on payment_sessions (provider, provider_ref)
  where provider_ref is not null;
create index payment_sessions_store_created
  on payment_sessions (store_id, created_at desc);

create table provider_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  type text not null,
  provider_ref text,
  amount_cents integer,
  session_id uuid references payment_sessions (id),
  outcome text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references payment_sessions (id),
  store_id uuid not null references stores (id),
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (length(reason) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  provider_ref text,
  idempotency_key text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (session_id, idempotency_key)
);

create table journal_entries (
  id bigint generated always as identity primary key,
  store_id uuid not null references stores (id),
  session_id uuid not null references payment_sessions (id),
  refund_id uuid references refunds (id),
  kind text not null check (kind in ('payment', 'refund')),
  created_at timestamptz not null default now()
);

create table journal_lines (
  id bigint generated always as identity primary key,
  entry_id bigint not null references journal_entries (id),
  -- provider_clearing: money the payment partner owes the store.
  -- store_payable: money that belongs to the store for this sale.
  account text not null check (account in ('provider_clearing', 'store_payable')),
  debit_cents integer not null default 0 check (debit_cents >= 0),
  credit_cents integer not null default 0 check (credit_cents >= 0),
  check ((debit_cents = 0) <> (credit_cents = 0))
);

create table audit_log (
  id bigint generated always as identity primary key,
  store_id uuid references stores (id),
  session_id uuid references payment_sessions (id),
  actor uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- ledger integrity

create function smokepay_check_entry_balanced() returns trigger
language plpgsql as $$
declare
  d bigint;
  c bigint;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    into d, c from journal_lines where entry_id = new.entry_id;
  if d <> c then
    raise exception 'journal entry % is not balanced (debits %, credits %)', new.entry_id, d, c;
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function smokepay_check_entry_balanced();

create function smokepay_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger journal_entries_append_only before update or delete on journal_entries
  for each row execute function smokepay_forbid_change();
create trigger journal_lines_append_only before update or delete on journal_lines
  for each row execute function smokepay_forbid_change();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function smokepay_forbid_change();

-- ------------------------------------------------------ row-level security

create function is_store_member(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from store_members where store_id = p_store and user_id = auth.uid()
  );
$$;

alter table stores enable row level security;
alter table store_members enable row level security;
alter table payment_sessions enable row level security;
alter table provider_events enable row level security;
alter table refunds enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table audit_log enable row level security;

-- Signed-in staff can read their own store's records. There are no insert,
-- update or delete policies: every write goes through the functions below,
-- which only the server (service role) may call.
create policy stores_read on stores for select to authenticated
  using (is_store_member(id));
create policy store_members_read on store_members for select to authenticated
  using (user_id = auth.uid());
create policy payment_sessions_read on payment_sessions for select to authenticated
  using (is_store_member(store_id));
create policy refunds_read on refunds for select to authenticated
  using (is_store_member(store_id));
create policy journal_entries_read on journal_entries for select to authenticated
  using (is_store_member(store_id));
create policy journal_lines_read on journal_lines for select to authenticated
  using (exists (
    select 1 from journal_entries e
    where e.id = journal_lines.entry_id and is_store_member(e.store_id)
  ));
create policy audit_log_read on audit_log for select to authenticated
  using (store_id is not null and is_store_member(store_id));

-- --------------------------------------------------------------- functions

create function sp_create_session(
  p_store uuid, p_actor uuid, p_order_ref text, p_amount_cents integer,
  p_token_hash text, p_phone_last4 text, p_ttl_minutes integer, p_idempotency_key text
) returns payment_sessions
language plpgsql security definer set search_path = public as $$
declare
  s payment_sessions;
begin
  if not exists (select 1 from store_members where store_id = p_store and user_id = p_actor) then
    raise exception 'not_a_member';
  end if;
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 60 then
    raise exception 'invalid_ttl';
  end if;

  select * into s from payment_sessions
    where store_id = p_store and idempotency_key = p_idempotency_key;
  if found then
    return s;
  end if;

  insert into payment_sessions
    (store_id, order_ref, amount_cents, token_hash, customer_phone_last4,
     created_by, idempotency_key, expires_at)
  values
    (p_store, p_order_ref, p_amount_cents, p_token_hash, p_phone_last4,
     p_actor, p_idempotency_key, now() + make_interval(mins => p_ttl_minutes))
  returning * into s;

  insert into audit_log (store_id, session_id, actor, action, detail)
  values (p_store, s.id, p_actor, 'session.created',
          jsonb_build_object('amount_cents', p_amount_cents, 'order_ref', p_order_ref));
  return s;
end $$;

create function sp_mark_processing(p_session uuid, p_provider text, p_provider_ref text)
returns payment_sessions
language plpgsql security definer set search_path = public as $$
declare
  s payment_sessions;
begin
  select * into s from payment_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if s.status <> 'open' then
    raise exception 'session_not_open';
  end if;
  if s.expires_at <= now() then
    update payment_sessions set status = 'expired', updated_at = now() where id = s.id;
    raise exception 'session_expired';
  end if;
  update payment_sessions
    set status = 'processing', provider = p_provider, provider_ref = p_provider_ref,
        updated_at = now()
    where id = s.id
    returning * into s;
  insert into audit_log (store_id, session_id, action, detail)
  values (s.store_id, s.id, 'session.processing', jsonb_build_object('provider', p_provider));
  return s;
end $$;

-- Applies one verified event from a payment partner. Safe to call twice with
-- the same event: the second call returns 'duplicate' and changes nothing.
create function sp_apply_provider_event(
  p_provider text, p_event_id text, p_type text, p_provider_ref text,
  p_amount_cents integer, p_payload jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  s payment_sessions;
  e bigint;
  n integer;
  result text;
begin
  insert into provider_events (provider, event_id, type, provider_ref, amount_cents, payload)
  values (p_provider, p_event_id, p_type, p_provider_ref, p_amount_cents, p_payload)
  on conflict (provider, event_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return 'duplicate';
  end if;

  select * into s from payment_sessions
    where provider = p_provider and provider_ref = p_provider_ref for update;

  if not found then
    result := 'unmatched';
  elsif p_type = 'payment.succeeded' then
    if s.status = 'processing' and p_amount_cents = s.amount_cents then
      update payment_sessions set status = 'paid', paid_at = now(), updated_at = now()
        where id = s.id;
      insert into journal_entries (store_id, session_id, kind)
        values (s.store_id, s.id, 'payment') returning id into e;
      insert into journal_lines (entry_id, account, debit_cents, credit_cents) values
        (e, 'provider_clearing', s.amount_cents, 0),
        (e, 'store_payable', 0, s.amount_cents);
      insert into audit_log (store_id, session_id, action, detail)
        values (s.store_id, s.id, 'session.paid', jsonb_build_object('event_id', p_event_id));
      result := 'paid';
    else
      -- Money reported for a session that was canceled, expired, already
      -- paid, or for a different amount. Never auto-resolve: a person reviews.
      insert into audit_log (store_id, session_id, action, detail)
        values (s.store_id, s.id, 'review.payment_event',
                jsonb_build_object('event_id', p_event_id, 'session_status', s.status,
                                   'event_amount_cents', p_amount_cents,
                                   'session_amount_cents', s.amount_cents));
      result := 'review';
    end if;
  elsif p_type = 'payment.failed' then
    if s.status = 'processing' then
      update payment_sessions set status = 'failed', updated_at = now() where id = s.id;
      insert into audit_log (store_id, session_id, action, detail)
        values (s.store_id, s.id, 'session.failed', jsonb_build_object('event_id', p_event_id));
      result := 'failed';
    else
      result := 'ignored';
    end if;
  else
    result := 'ignored';
  end if;

  update provider_events set session_id = s.id, outcome = result
    where provider = p_provider and event_id = p_event_id;
  return result;
end $$;

create function sp_cancel_session(p_session uuid, p_actor uuid) returns payment_sessions
language plpgsql security definer set search_path = public as $$
declare
  s payment_sessions;
begin
  select * into s from payment_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if not exists (select 1 from store_members where store_id = s.store_id and user_id = p_actor) then
    raise exception 'not_a_member';
  end if;
  if s.status not in ('open', 'processing') then
    raise exception 'session_not_cancelable';
  end if;
  update payment_sessions set status = 'canceled', updated_at = now() where id = s.id
    returning * into s;
  insert into audit_log (store_id, session_id, actor, action)
    values (s.store_id, s.id, p_actor, 'session.canceled');
  return s;
end $$;

create function sp_expire_sessions() returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update payment_sessions set status = 'expired', updated_at = now()
    where status = 'open' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

create function sp_request_refund(
  p_session uuid, p_actor uuid, p_amount_cents integer, p_reason text, p_idempotency_key text
) returns refunds
language plpgsql security definer set search_path = public as $$
declare
  s payment_sessions;
  r refunds;
  already bigint;
begin
  select * into s from payment_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if not exists (
    select 1 from store_members
    where store_id = s.store_id and user_id = p_actor and role in ('owner', 'manager')
  ) then
    raise exception 'not_allowed';
  end if;

  select * into r from refunds where session_id = p_session and idempotency_key = p_idempotency_key;
  if found then
    return r;
  end if;

  if s.status not in ('paid', 'partially_refunded') then
    raise exception 'session_not_refundable';
  end if;
  select coalesce(sum(amount_cents), 0) into already
    from refunds where session_id = p_session and status in ('pending', 'succeeded');
  if p_amount_cents is null or p_amount_cents <= 0 or already + p_amount_cents > s.amount_cents then
    raise exception 'refund_exceeds_payment';
  end if;

  insert into refunds (session_id, store_id, amount_cents, reason, idempotency_key, created_by)
    values (p_session, s.store_id, p_amount_cents, p_reason, p_idempotency_key, p_actor)
    returning * into r;
  insert into audit_log (store_id, session_id, actor, action, detail)
    values (s.store_id, s.id, p_actor, 'refund.requested',
            jsonb_build_object('refund_id', r.id, 'amount_cents', p_amount_cents));
  return r;
end $$;

create function sp_settle_refund(p_refund uuid, p_succeeded boolean, p_provider_ref text)
returns refunds
language plpgsql security definer set search_path = public as $$
declare
  r refunds;
  s payment_sessions;
  e bigint;
  total bigint;
begin
  select * into r from refunds where id = p_refund for update;
  if not found then
    raise exception 'refund_not_found';
  end if;
  if r.status <> 'pending' then
    return r;
  end if;
  select * into s from payment_sessions where id = r.session_id for update;

  if not p_succeeded then
    update refunds set status = 'failed', provider_ref = p_provider_ref, settled_at = now()
      where id = r.id returning * into r;
    insert into audit_log (store_id, session_id, action, detail)
      values (r.store_id, r.session_id, 'refund.failed', jsonb_build_object('refund_id', r.id));
    return r;
  end if;

  update refunds set status = 'succeeded', provider_ref = p_provider_ref, settled_at = now()
    where id = r.id returning * into r;
  insert into journal_entries (store_id, session_id, refund_id, kind)
    values (r.store_id, r.session_id, r.id, 'refund') returning id into e;
  insert into journal_lines (entry_id, account, debit_cents, credit_cents) values
    (e, 'store_payable', r.amount_cents, 0),
    (e, 'provider_clearing', 0, r.amount_cents);

  select coalesce(sum(amount_cents), 0) into total
    from refunds where session_id = r.session_id and status = 'succeeded';
  update payment_sessions
    set status = case when total >= s.amount_cents then 'refunded' else 'partially_refunded' end,
        updated_at = now()
    where id = r.session_id;
  insert into audit_log (store_id, session_id, action, detail)
    values (r.store_id, r.session_id, 'refund.succeeded',
            jsonb_build_object('refund_id', r.id, 'amount_cents', r.amount_cents));
  return r;
end $$;

-- ------------------------------------------------------------------ grants
-- Only the server may run the money functions.

revoke all on function sp_create_session(uuid, uuid, text, integer, text, text, integer, text) from public, anon, authenticated;
revoke all on function sp_mark_processing(uuid, text, text) from public, anon, authenticated;
revoke all on function sp_apply_provider_event(text, text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function sp_cancel_session(uuid, uuid) from public, anon, authenticated;
revoke all on function sp_expire_sessions() from public, anon, authenticated;
revoke all on function sp_request_refund(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function sp_settle_refund(uuid, boolean, text) from public, anon, authenticated;

grant execute on function sp_create_session(uuid, uuid, text, integer, text, text, integer, text) to service_role;
grant execute on function sp_mark_processing(uuid, text, text) to service_role;
grant execute on function sp_apply_provider_event(text, text, text, text, integer, jsonb) to service_role;
grant execute on function sp_cancel_session(uuid, uuid) to service_role;
grant execute on function sp_expire_sessions() to service_role;
grant execute on function sp_request_refund(uuid, uuid, integer, text, text) to service_role;
grant execute on function sp_settle_refund(uuid, boolean, text) to service_role;

revoke insert, update, delete, truncate on
  stores, store_members, payment_sessions, provider_events, refunds,
  journal_entries, journal_lines, audit_log
from anon, authenticated;
