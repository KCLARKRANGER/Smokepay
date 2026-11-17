import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

// Runs the real migration against an in-process Postgres so the money rules
// are tested exactly as the database will enforce them.
const migrations = ['0001_smokepay_core.sql', '0002_store_invites.sql', '0003_security_hardening.sql'].map((f) =>
  readFileSync(join(__dirname, '..', 'supabase', 'migrations', f), 'utf8'),
);

// What Supabase provides out of the box and the migration relies on.
const supabasePrelude = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const OWNER = '00000000-0000-0000-0000-0000000000a1';
const CASHIER = '00000000-0000-0000-0000-0000000000a2';
const STRANGER = '00000000-0000-0000-0000-0000000000a3';

let db: PGlite;
let storeId: string;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function createSession(amount = 4800, key = 'k1', actor = CASHIER) {
  return one<{ id: string; status: string; amount_cents: number }>(
    `select * from sp_create_session($1, $2, 'ORD-1', $3, $4, '0148', 15, $5)`,
    [storeId, actor, amount, `hash-${key}`, key],
  );
}

async function payFor(sessionId: string, ref: string, amount: number, eventId = `evt-${ref}`) {
  await db.query(`select sp_mark_processing($1, 'testpartner', $2)`, [sessionId, ref]);
  return one<{ r: string }>(
    `select sp_apply_provider_event('testpartner', $1, 'payment.succeeded', $2, $3, '{}'::jsonb) as r`,
    [eventId, ref, amount],
  );
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(supabasePrelude);
  for (const m of migrations) await db.exec(m);
  const s = await one<{ id: string }>(`insert into stores (name) values ('Test Store') returning id`);
  storeId = s.id;
  await db.query(
    `insert into store_members (store_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'cashier')`,
    [storeId, OWNER, CASHIER],
  );
});

describe('payment sessions', () => {
  it('creates a session and replays the same idempotency key', async () => {
    const a = await createSession();
    const b = await createSession();
    expect(a.status).toBe('open');
    expect(b.id).toBe(a.id);
    const n = await one<{ c: number }>(`select count(*)::int as c from payment_sessions`);
    expect(n.c).toBe(1);
  });

  it('refuses people who are not staff of the store', async () => {
    await expect(createSession(4800, 'k2', STRANGER)).rejects.toThrow(/not_a_member/);
  });

  it('refuses zero, negative and oversized amounts', async () => {
    await expect(createSession(0, 'z')).rejects.toThrow();
    await expect(createSession(-5, 'n')).rejects.toThrow();
    await expect(createSession(500001, 'big')).rejects.toThrow();
  });

  it('marks paid on a matching partner event and posts a balanced entry', async () => {
    const s = await createSession();
    const r = await payFor(s.id, 'ref-1', 4800);
    expect(r.r).toBe('paid');
    const after = await one<{ status: string }>(`select status from payment_sessions where id = $1`, [s.id]);
    expect(after.status).toBe('paid');
    const sums = await one<{ d: number; c: number }>(
      `select sum(debit_cents)::int as d, sum(credit_cents)::int as c from journal_lines`,
    );
    expect(sums).toEqual({ d: 4800, c: 4800 });
  });

  it('ignores a repeated partner event', async () => {
    const s = await createSession();
    await payFor(s.id, 'ref-1', 4800, 'evt-1');
    const again = await one<{ r: string }>(
      `select sp_apply_provider_event('testpartner', 'evt-1', 'payment.succeeded', 'ref-1', 4800, '{}'::jsonb) as r`,
    );
    expect(again.r).toBe('duplicate');
    const n = await one<{ c: number }>(`select count(*)::int as c from journal_entries`);
    expect(n.c).toBe(1);
  });

  it('sends an amount mismatch to review without marking paid', async () => {
    const s = await createSession();
    const r = await payFor(s.id, 'ref-1', 4700);
    expect(r.r).toBe('review');
    const after = await one<{ status: string }>(`select status from payment_sessions where id = $1`, [s.id]);
    expect(after.status).toBe('processing');
    const n = await one<{ c: number }>(`select count(*)::int as c from journal_entries`);
    expect(n.c).toBe(0);
  });

  it('sends money for a canceled session to review', async () => {
    const s = await createSession();
    await db.query(`select sp_mark_processing($1, 'testpartner', 'ref-9')`, [s.id]);
    await db.query(`select sp_cancel_session($1, $2)`, [s.id, CASHIER]);
    const r = await one<{ r: string }>(
      `select sp_apply_provider_event('testpartner', 'evt-9', 'payment.succeeded', 'ref-9', 4800, '{}'::jsonb) as r`,
    );
    expect(r.r).toBe('review');
    const after = await one<{ status: string }>(`select status from payment_sessions where id = $1`, [s.id]);
    expect(after.status).toBe('canceled');
  });

  it('will not start checkout on an expired session', async () => {
    const s = await createSession();
    await db.query(`update payment_sessions set expires_at = now() - interval '1 minute' where id = $1`, [s.id]);
    await expect(
      db.query(`select sp_mark_processing($1, 'testpartner', 'ref-x')`, [s.id]),
    ).rejects.toThrow(/session_expired/);
  });

  it('marks failed on a partner failure event', async () => {
    const s = await createSession();
    await db.query(`select sp_mark_processing($1, 'testpartner', 'ref-f')`, [s.id]);
    const r = await one<{ r: string }>(
      `select sp_apply_provider_event('testpartner', 'evt-f', 'payment.failed', 'ref-f', 4800, '{}'::jsonb) as r`,
    );
    expect(r.r).toBe('failed');
  });
});

describe('refunds', () => {
  it('lets a cashier request nothing, and an owner refund in parts up to the total', async () => {
    const s = await createSession();
    await payFor(s.id, 'ref-1', 4800);

    await expect(
      db.query(`select sp_request_refund($1, $2, 1000, 'damaged', 'r0')`, [s.id, CASHIER]),
    ).rejects.toThrow(/not_allowed/);

    const r1 = await one<{ id: string }>(
      `select * from sp_request_refund($1, $2, 1000, 'damaged', 'r1')`, [s.id, OWNER]);
    await db.query(`select sp_settle_refund($1, true, 'rf-1')`, [r1.id]);
    let st = await one<{ status: string }>(`select status from payment_sessions where id = $1`, [s.id]);
    expect(st.status).toBe('partially_refunded');

    await expect(
      db.query(`select sp_request_refund($1, $2, 3801, 'too much', 'r2')`, [s.id, OWNER]),
    ).rejects.toThrow(/refund_exceeds_payment/);

    const r3 = await one<{ id: string }>(
      `select * from sp_request_refund($1, $2, 3800, 'rest', 'r3')`, [s.id, OWNER]);
    await db.query(`select sp_settle_refund($1, true, 'rf-3')`, [r3.id]);
    st = await one<{ status: string }>(`select status from payment_sessions where id = $1`, [s.id]);
    expect(st.status).toBe('refunded');

    // Store payable nets to zero after a full refund.
    const net = await one<{ n: number }>(
      `select (sum(credit_cents) - sum(debit_cents))::int as n from journal_lines where account = 'store_payable'`,
    );
    expect(net.n).toBe(0);
  });

  it('does not double-post when a refund is settled twice', async () => {
    const s = await createSession();
    await payFor(s.id, 'ref-1', 4800);
    const r = await one<{ id: string }>(
      `select * from sp_request_refund($1, $2, 4800, 'return', 'r1')`, [s.id, OWNER]);
    await db.query(`select sp_settle_refund($1, true, 'rf-1')`, [r.id]);
    await db.query(`select sp_settle_refund($1, true, 'rf-1')`, [r.id]);
    const n = await one<{ c: number }>(`select count(*)::int as c from journal_entries where kind = 'refund'`);
    expect(n.c).toBe(1);
  });
});

describe('ledger integrity', () => {
  it('rejects an unbalanced journal entry', async () => {
    const s = await createSession();
    await payFor(s.id, 'ref-1', 4800);
    await expect(
      db.exec(`
        begin;
        insert into journal_entries (store_id, session_id, kind) values ('${storeId}', '${s.id}', 'payment');
        insert into journal_lines (entry_id, account, debit_cents)
          select max(id), 'provider_clearing', 500 from journal_entries;
        commit;
      `),
    ).rejects.toThrow(/not balanced/);
    await db.exec('rollback').catch(() => {});
  });

  it('refuses edits and deletes on the journal and audit log', async () => {
    const s = await createSession();
    await payFor(s.id, 'ref-1', 4800);
    await expect(db.query(`update journal_lines set debit_cents = 1 where debit_cents > 0`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from journal_entries`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
  });
});

describe('row-level security', () => {
  it('shows staff only their own store and blocks direct writes', async () => {
    const other = await one<{ id: string }>(`insert into stores (name) values ('Other Store') returning id`);
    await createSession();
    await db.exec(`grant usage on schema public to authenticated; grant select on all tables in schema public to authenticated;`);

    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${CASHIER}';`);
    const stores = await db.query<{ id: string }>(`select id from stores`);
    expect(stores.rows.map((r) => r.id)).toEqual([storeId]);
    expect(stores.rows.some((r) => r.id === other.id)).toBe(false);
    await expect(db.query(`update payment_sessions set status = 'paid'`)).rejects.toThrow();
    await expect(
      db.query(`select sp_apply_provider_event('x', 'e', 'payment.succeeded', 'r', 1, '{}'::jsonb)`),
    ).rejects.toThrow(/permission denied/);

    await db.exec(`set request.jwt.claim.sub = '${STRANGER}';`);
    const none = await db.query(`select id from payment_sessions`);
    expect(none.rows.length).toBe(0);
    await db.exec(`reset role;`);
  });
});

describe('staff invites', () => {
  const NEW_USER = '00000000-0000-0000-0000-0000000000b1';

  it('links an invited email when that account is created', async () => {
    await db.query(`select sp_invite($1, $2, 'New.Hire@Example.com', 'cashier')`, [storeId, OWNER]);
    let m = await db.query<{ role: string }>(`select role from store_members where user_id = $1`, [NEW_USER]);
    expect(m.rows.length).toBe(0);
    await db.query(`insert into auth.users (id, email) values ($1, 'new.hire@example.com')`, [NEW_USER]);
    m = await db.query<{ role: string }>(`select role from store_members where user_id = $1`, [NEW_USER]);
    expect(m.rows[0]?.role).toBe('cashier');
    const inv = await one<{ accepted_at: string | null }>(`select accepted_at from store_invites where email = 'new.hire@example.com'`);
    expect(inv.accepted_at).not.toBeNull();
  });

  it('links an existing account immediately', async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'existing@example.com')`, [NEW_USER]);
    const inv = await one<{ accepted_at: string | null }>(
      `select * from sp_invite($1, $2, 'existing@example.com', 'manager')`, [storeId, OWNER]);
    expect(inv.accepted_at).not.toBeNull();
    const m = await one<{ role: string }>(`select role from store_members where user_id = $1`, [NEW_USER]);
    expect(m.role).toBe('manager');
  });

  it('lets only owners and managers invite, and stops managers making owners', async () => {
    await expect(
      db.query(`select sp_invite($1, $2, 'x@example.com', 'cashier')`, [storeId, CASHIER]),
    ).rejects.toThrow(/not_allowed/);
    await expect(
      db.query(`select sp_invite($1, $2, 'x@example.com', 'cashier')`, [storeId, STRANGER]),
    ).rejects.toThrow(/not_allowed/);
    await db.query(`select sp_invite($1, $2, 'mgr@example.com', 'manager')`, [storeId, OWNER]);
    const MGR = '00000000-0000-0000-0000-0000000000b2';
    await db.query(`insert into auth.users (id, email) values ($1, 'mgr@example.com')`, [MGR]);
    await expect(
      db.query(`select sp_invite($1, $2, 'boss@example.com', 'owner')`, [storeId, MGR]),
    ).rejects.toThrow(/not_allowed/);
    const ok = await one<{ role: string }>(`select * from sp_invite($1, $2, 'till@example.com', 'cashier')`, [storeId, MGR]);
    expect(ok.role).toBe('cashier');
  });

  it('lets the server bootstrap the first owner with no acting user', async () => {
    const s2 = await one<{ id: string }>(`insert into stores (name) values ('Second') returning id`);
    const inv = await one<{ role: string }>(`select * from sp_invite($1, null, 'founder@example.com', 'owner')`, [s2.id]);
    expect(inv.role).toBe('owner');
  });
});
